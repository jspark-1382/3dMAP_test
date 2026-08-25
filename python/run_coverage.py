# -*- coding: utf-8 -*-
# ============================================================
# Sionna RT 기반 OM900 커버리지 예측
#   사용법:
#     .venv-sionna/Scripts/python python/run_coverage.py          # 전체 실행
#     .venv-sionna/Scripts/python python/run_coverage.py --quick  # 빠른 검증(저해상도)
#
#   출력: Data/sionna/sionna_coverage.json  (웹앱에서 fetch하여 표시)
# ============================================================
import argparse
import datetime as _dt
import json
import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sionna_config as CFG
from pattern_loader import load_pattern

import drjit as dr
import mitsuba as mi
import sionna.rt as rt

OUTPUT_DIR = os.path.normpath(os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "Data", "sionna"))
OUTPUT_FILE = os.path.join(OUTPUT_DIR, "sionna_coverage.json")

PATTERN_NAME = "om900_measured"

WGS84_A = 6378137.0
WGS84_E2 = 6.69437999014e-3


def enu_to_latlon(e, n, u, lat0, lon0, h0):
    """원점(lat0,lon0,h0) 기준 ENU 오프셋(m) -> (lat, lon, h). ±수백m에서 충분히 정확."""
    lat = math.radians(lat0)
    s = math.sin(lat)
    n_rad = WGS84_A / math.sqrt(1.0 - WGS84_E2 * s * s)               # 卯酉 곡률반경
    m_rad = WGS84_A * (1 - WGS84_E2) / (1 - WGS84_E2 * s * s) ** 1.5  # 자오 곡률반경
    lat_out = math.degrees(lat + n / m_rad)
    lon_out = lon0 + math.degrees(e / (n_rad * math.cos(lat)))
    return lat_out, lon_out, h0 + u


AMP_TABLE_RES = 0.25  # 보간 테이블 각도 해상도(deg)


def build_v_pattern(pattern):
    """측정 수직면 패턴(dBi)을 절대이득 보정된 진폭 테이블로 변환.

    - 상대 패턴(최대=0dB)을 진폭으로 환산
    - 방사 효율 조정으로 피크 이득 = 측정 최대이득(dBi)이 되도록 크기 보정
      (Sionna는 패턴 모양으로부터 등가이득을 적분하므로,
       측정 절대이득 반영을 위해 진폭에 sqrt(G_meas/D_shape) 를 곱함)
    """
    theta_deg = np.asarray(pattern["theta_deg"], dtype=float)
    gain_db = np.asarray(pattern["gain_v_dbi"], dtype=float)

    order = np.argsort(theta_deg)
    theta_deg = theta_deg[order]
    gain_db = gain_db[order]

    # 균일 각도 그리드 선형보간 (0=천정 ~ 180=저중, Sionna theta 규약과 동일)
    grid_deg = np.arange(0.0, 180.0 + AMP_TABLE_RES, AMP_TABLE_RES)
    rel_db = np.interp(grid_deg, theta_deg, gain_db)
    rel_db -= rel_db.max()               # 상대화(최대 0 dB)
    amp = 10.0 ** (rel_db / 20.0)        # 진폭 비례

    # 형태 유래 지향성 (방위 균일 가정): D = g_max / eta
    th = np.radians(grid_deg)
    g = amp ** 2
    eta_norm = float(np.trapezoid(g * np.sin(th), th)) / 2.0
    d_shape = 1.0 / max(eta_norm, 1e-12)
    g_meas_lin = 10.0 ** (pattern["max_gain_dbi"] / 10.0)
    scale = math.sqrt(g_meas_lin / d_shape)
    amp *= scale

    print("패턴 보정: 형태 지향성 %.2f dBi -> 목표 이득 %.2f dBi (진폭 스케일 %.3f)"
          % (10 * math.log10(d_shape), pattern["max_gain_dbi"], scale))

    return amp.astype(np.float32)


def make_pattern_factory(amp_table):
    """등록용 팩토리: (theta,phi) -> Complex2f 진폭 (선형보간 + drjit 배치 연산)."""
    n_tab = len(amp_table)
    tab = mi.TensorXf(amp_table)

    def v_pattern(theta, phi):
        x = dr.clip(theta / dr.pi, 0.0, 1.0) * float(n_tab - 1)
        i0 = mi.UInt32(dr.floor(x))
        i1 = dr.minimum(i0 + 1, mi.UInt32(n_tab - 1))
        f = x - dr.floor(x)
        a0 = dr.gather(mi.Float, tab.array, i0)
        a1 = dr.gather(mi.Float, tab.array, i1)
        c = a0 * (1.0 - f) + a1 * f
        return mi.Complex2f(c, 0)

    def factory(*, polarization="V", polarization_model="tr38901_2"):
        return rt.PolarizedAntennaPattern(v_pattern=v_pattern,
                                          polarization=polarization,
                                          polarization_model=polarization_model)

    return factory


GROUND_XML_FMT = """<scene version="2.1.0">
  <shape type="rectangle" id="ground">
    <bsdf type="radio-material" id="mat-soil">
      <float name="relative_permittivity" value="{er}"/>
      <float name="conductivity" value="{cond}"/>
    </bsdf>
    <transform name="to_world">
      <scale x="{s}" y="{s}" z="1"/>
    </transform>
  </shape>
</scene>
"""

# ITU-R P.2040 medium_dry_ground 특성 (910MHz 외삽값: 1GHz 기준)
SOIL_PERMITTIVITY = 15.0
SOIL_CONDUCTIVITY = 0.035



def run(quick=False):
    bs_lat, bs_lon = CFG.bs_lat_lon()
    print("기지국: lat=%.7f, lon=%.7f, 안테나 고도 %.1fm"
          % (bs_lat, bs_lon, CFG.BS_ALT_M))

    # 1) 측정 패턴 등록
    pattern = load_pattern(freq=CFG.FREQ_BAND)
    rt.register_antenna_pattern(PATTERN_NAME,
                                make_pattern_factory(build_v_pattern(pattern)))

    # 2) 장면: 평지(지면만 있는 농어촌 가정, 토양 재질은 XML에서 정의)
    scene = rt.load_scene_from_string(GROUND_XML_FMT.format(
        s=8000, er=SOIL_PERMITTIVITY, cond=SOIL_CONDUCTIVITY))
    scene.frequency = mi.Float(CFG.FREQ_HZ)

    scene.tx_array = rt.PlanarArray(num_rows=1, num_cols=1,
                                    pattern=PATTERN_NAME, polarization="V")
    scene.rx_array = rt.PlanarArray(num_rows=1, num_cols=1,
                                    pattern="iso", polarization="V")

    tx = rt.Transmitter(name="bs", position=mi.Point3f(0.0, 0.0, CFG.BS_ALT_M),
                        power_dbm=CFG.TX_POWER_DBM)
    scene.add(tx)

    # 3) 단말 고도별 커버리지 맵 (수평 평면 라디오맵)
    solver = rt.RadioMapSolver()
    size = 400.0 if quick else CFG.GRID_SIZE_M
    cell = 40.0 if quick else CFG.CELL_SIZE_M
    max_depth = 1 if quick else CFG.MAX_DEPTH
    samples = 20000 if quick else CFG.NUM_SAMPLES

    result = {
        "meta": {
            "tool": "Sionna RT %s" % rt.__version__,
            "generated": _dt.datetime.now().isoformat(timespec="seconds"),
            "antennaModel": pattern["model"],
            "frequencyMHz": int(CFG.FREQ_HZ / 1e6),
            "txPowerDbm": CFG.TX_POWER_DBM,
            "antennaMaxGainDbi": round(pattern["max_gain_dbi"], 2),
            "antennaHeightM": CFG.BS_ALT_M,
            "bs": {"lat": round(bs_lat, 7), "lon": round(bs_lon, 7)},
            "gridSizeM": size,
            "cellSizeM": cell,
            "maxDepth": max_depth,
            "altitudesM": list(CFG.TERMINAL_ALTS_M),
            "coverageThresholdDbm": CFG.COVERAGE_THRESHOLD_DBM,
        },
        "grids": {},
    }

    for alt in CFG.TERMINAL_ALTS_M:
        print("== 단말 고도 %dm 시뮬레이션 중..." % alt, flush=True)
        rmap = solver(scene,
                      center=mi.Point3f(0.0, 0.0, float(alt)),
                      orientation=mi.Point3f(0.0, 0.0, 0.0),  # 수평 평면(법선 +z)
                      size=mi.Point2f(size, size),
                      cell_size=mi.Point2f(cell, cell),
                      samples_per_tx=samples,
                      max_depth=max_depth,
                      specular_reflection=True,
                      diffuse_reflection=False)

        centers = rmap.cell_centers           # TensorXf (N,3) ENU[m]
        try:
            c2 = np.array(dr.detach(centers), dtype=float)
        except TypeError:
            c2 = np.array(centers, dtype=float)
        c2 = c2.reshape(-1, 3)
        cx, cy = c2[:, 0], c2[:, 1]
        pg = np.array(dr.detach(rmap.path_gain)).ravel()             # 단일 TX
        pr_dbm = CFG.TX_POWER_DBM + 10.0 * np.log10(np.maximum(pg, 1e-30))

        pts = []
        for i in range(len(cx)):
            la, lo, _ = enu_to_latlon(float(cx[i]), float(cy[i]),
                                      0.0, bs_lat, bs_lon, 0.0)
            pts.append([round(la, 6), round(lo, 6), round(float(pr_dbm[i]), 1)])

        arr = np.array([p[2] for p in pts])
        stats = {
            "count": len(pts),
            "meanDbm": round(float(arr.mean()), 1),
            "minDbm": round(float(arr.min()), 1),
            "maxDbm": round(float(arr.max()), 1),
            "coveragePct": round(float((arr >= CFG.COVERAGE_THRESHOLD_DBM).mean() * 100.0), 1),
        }
        result["grids"][str(alt)] = {"points": pts, "stats": stats}
        print("   셀 수 %d / 평균 %.1f dBm / 최소 %.1f / 커버리지 %.1f%%"
              % (stats["count"], stats["meanDbm"], stats["minDbm"],
                 stats["coveragePct"]), flush=True)

    os.makedirs(OUTPUT_DIR, exist_ok=True)
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False)
    print("\n저장 완료: %s (%.1f KB)"
          % (OUTPUT_FILE, os.path.getsize(OUTPUT_FILE) / 1024.0))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--quick", action="store_true",
                    help="저해상도 빠른 검증 실행")
    args = ap.parse_args()
    run(quick=args.quick)
