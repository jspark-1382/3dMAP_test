# -*- coding: utf-8 -*-
"""
Sionna RT 기반 이중 야기 + 옴니 커버리지 예측.

현재 단계:
- 260827_pattern.xlsx의 야기+옴니 horizontal-plane + vertical-plane 2D cut으로
  separable 3D 안테나 패턴을 근사한다.
- 추후 드론 실측 데이터가 생기면 이 기본 패턴 위에 3D correction을 추가한다.
"""

from __future__ import annotations

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
from formula_pathloss import calculate_result as calculate_formula_result
from formula_pathloss import OUTPUT_FILE as FORMULA_OUTPUT_FILE

import drjit as dr
import mitsuba as mi
import sionna.rt as rt


OUTPUT_DIR = os.path.normpath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "Data", "sionna")
)
OUTPUT_FILE = os.path.join(OUTPUT_DIR, "sionna_coverage.json")
FREE_SPACE_OUTPUT_FILE = os.path.join(OUTPUT_DIR, "sionna_free_space.json")

PATTERN_NAME = "dual_yagi_omni_260827_2cut_3d"

WGS84_A = 6378137.0
WGS84_E2 = 6.69437999014e-3


def enu_to_latlon(e, n, u, lat0, lon0, h0):
    """Local ENU offset[m] -> latitude, longitude, height."""
    lat = math.radians(lat0)
    s = math.sin(lat)

    n_rad = WGS84_A / math.sqrt(1.0 - WGS84_E2 * s * s)
    m_rad = (
        WGS84_A * (1.0 - WGS84_E2)
        / (1.0 - WGS84_E2 * s * s) ** 1.5
    )

    lat_out = math.degrees(lat + n / m_rad)
    lon_out = lon0 + math.degrees(e / (n_rad * math.cos(lat)))
    return lat_out, lon_out, h0 + u


def build_pattern_tables(pattern):
    """
    2개의 실측 2D cut을 Sionna용 3D separable field pattern으로 준비한다.

    G_3D(theta, phi) [dB] ≈
        Gv_rel(theta) + Gh_rel(phi) + G_peak

    즉 field amplitude는
        Av(theta) * Ah(phi) * sqrt(G_peak_linear)

    로 만든다.

    이것은 완전한 3D chamber 측정값이 없는 현재 단계에서 사용하는 근사다.
    """
    res = float(CFG.ANTENNA_PATTERN_RES_DEG)

    # ---------- Vertical / theta ----------
    theta_src = np.asarray(pattern["theta_deg"], dtype=float)
    gv_src = np.asarray(pattern["vertical_gain_dbi"], dtype=float)

    theta_grid = np.arange(0.0, 180.0 + res * 0.5, res)
    gv = np.interp(theta_grid, theta_src, gv_src)

    # vertical cut은 shape만 사용
    gv_rel = gv - np.max(gv)
    amp_v = np.power(10.0, gv_rel / 20.0)

    # ---------- Horizontal / phi ----------
    phi_src = np.asarray(pattern["phi_deg"], dtype=float)
    gh_src = np.asarray(pattern["horizontal_gain_dbi"], dtype=float)

    # 설치 방향 offset 적용
    offset = float(CFG.ANTENNA_AZIMUTH_OFFSET_DEG)

    phi_grid = np.arange(-180.0, 180.0 + res * 0.5, res)

    # periodic interpolation:
    # query phi에서 offset을 빼면 안테나 자체 패턴 좌표가 된다.
    query = ((phi_grid - offset + 180.0) % 360.0) - 180.0

    # np.interp는 x가 증가해야 하므로 periodic 확장
    phi_ext = np.concatenate([phi_src - 360.0, phi_src, phi_src + 360.0])
    gh_ext = np.concatenate([gh_src, gh_src, gh_src])
    gh = np.interp(query, phi_ext, gh_ext)

    # horizontal cut도 shape만 사용
    gh_rel = gh - np.max(gh)
    amp_h = np.power(10.0, gh_rel / 20.0)

    # ---------- Absolute peak gain ----------
    peak_gain_dbi = float(pattern["max_gain_dbi"])
    peak_field_scale = math.sqrt(10.0 ** (peak_gain_dbi / 10.0))

    print(
        "안테나 3D 근사: "
        f"H-plane max={pattern['horizontal_max_gain_dbi']:.2f} dBi, "
        f"V-plane max={pattern['vertical_max_gain_dbi']:.2f} dBi, "
        f"target peak={peak_gain_dbi:.2f} dBi"
    )

    return (
        amp_v.astype(np.float32),
        amp_h.astype(np.float32),
        peak_field_scale,
    )


def make_pattern_factory(amp_v_table, amp_h_table, peak_field_scale):
    """
    Sionna custom antenna pattern.

    theta: 0..pi
    phi  : -pi..pi
    """
    n_v = len(amp_v_table)
    n_h = len(amp_h_table)

    tab_v = mi.TensorXf(amp_v_table)
    tab_h = mi.TensorXf(amp_h_table)

    def v_pattern(theta, phi):
        # theta -> vertical table
        xv = dr.clip(theta / dr.pi, 0.0, 1.0) * float(n_v - 1)
        i0v = mi.UInt32(dr.floor(xv))
        i1v = dr.minimum(i0v + 1, mi.UInt32(n_v - 1))
        fv = xv - dr.floor(xv)

        av0 = dr.gather(mi.Float, tab_v.array, i0v)
        av1 = dr.gather(mi.Float, tab_v.array, i1v)
        av = av0 * (1.0 - fv) + av1 * fv

        # phi is periodic. Sionna phi is expected in [-pi, pi].
        ph = phi
        xn = (ph + dr.pi) / (2.0 * dr.pi)
        xn = xn - dr.floor(xn)   # 0 <= xn < 1

        # 마지막 endpoint(+180)을 포함한 table 사용
        xh = xn * float(n_h - 1)
        i0h = mi.UInt32(dr.floor(xh))
        i1h = dr.minimum(i0h + 1, mi.UInt32(n_h - 1))
        fh = xh - dr.floor(xh)

        ah0 = dr.gather(mi.Float, tab_h.array, i0h)
        ah1 = dr.gather(mi.Float, tab_h.array, i1h)
        ah = ah0 * (1.0 - fh) + ah1 * fh

        field = av * ah * float(peak_field_scale)
        return mi.Complex2f(field, 0.0)

    def factory(*, polarization="V", polarization_model="tr38901_2"):
        return rt.PolarizedAntennaPattern(
            v_pattern=v_pattern,
            polarization=polarization,
            polarization_model=polarization_model,
        )

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

# 현재는 평지 모델.
# 추후 DEM / building mesh를 넣을 때 scene 부분만 교체하면 된다.
SOIL_PERMITTIVITY = 15.0
SOIL_CONDUCTIVITY = 0.035


def save_result(result, path):
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False)
    print(f"저장 완료: {path} ({os.path.getsize(path) / 1024.0:.1f} KB)")


def create_scene():
    """두 비교 환경이 공유하는 동일 장면/배열/송신원을 만든다."""
    scene = rt.load_scene_from_string(
        GROUND_XML_FMT.format(
            s=8000,
            er=SOIL_PERMITTIVITY,
            cond=SOIL_CONDUCTIVITY,
        )
    )
    scene.frequency = mi.Float(CFG.FREQ_HZ)
    scene.tx_array = rt.PlanarArray(
        num_rows=1,
        num_cols=1,
        pattern=PATTERN_NAME,
        polarization="V",
    )
    scene.rx_array = rt.PlanarArray(
        num_rows=1,
        num_cols=1,
        pattern="iso",
        polarization="V",
    )
    scene.add(rt.Transmitter(
        name="bs",
        position=mi.Point3f(0.0, 0.0, CFG.BS_ALT_M),
        power_dbm=CFG.TX_POWER_DBM,
    ))
    return scene


def solve_rt_result(scene, solver, pattern, quick, direct_only):
    """동일한 Sionna RT 설정에서 반사 포함 또는 직접파 전용 결과를 계산한다."""
    bs_lat, bs_lon = CFG.bs_lat_lon()
    size = 400.0 if quick else CFG.GRID_SIZE_M
    cell = 40.0 if quick else CFG.CELL_SIZE_M
    samples = 20_000 if quick else CFG.NUM_SAMPLES
    max_depth = 0 if direct_only else (1 if quick else CFG.MAX_DEPTH)
    environment_label = "자유공간 직접파" if direct_only else "평탄 지면"

    result = {
        "meta": {
            "tool": f"Sionna RT {rt.__version__}",
            "generated": _dt.datetime.now().isoformat(timespec="seconds"),
            "antennaModel": pattern["model"],
            "antennaConfiguration": pattern.get("configuration"),
            "antennaSourceFile": pattern.get("source_file"),
            "antennaSourceSheet": pattern.get("source_sheet"),
            "antennaPatternMode": "2D horizontal + 2D vertical -> separable 3D approximation",
            "frequencyMHz": int(CFG.FREQ_HZ / 1e6),
            "txPowerDbm": CFG.TX_POWER_DBM,
            "antennaMaxGainDbi": round(pattern["max_gain_dbi"], 2),
            "horizontalMaxGainDbi": round(pattern["horizontal_max_gain_dbi"], 2),
            "verticalMaxGainDbi": round(pattern["vertical_max_gain_dbi"], 2),
            "antennaHeightM": CFG.BS_ALT_M,
            "antennaAzimuthOffsetDeg": CFG.ANTENNA_AZIMUTH_OFFSET_DEG,
            "bs": {"lat": round(bs_lat, 7), "lon": round(bs_lon, 7)},
            "gridSizeM": size,
            "cellSizeM": cell,
            "samplesPerTx": samples,
            "maxDepth": max_depth,
            "losOnly": direct_only,
            "altitudesM": list(CFG.TERMINAL_ALTS_M),
            "coverageThresholdDbm": CFG.COVERAGE_THRESHOLD_DBM,
            "sceneModel": (
                "free space (Sionna direct path only)"
                if direct_only else "flat ground with specular reflection"
            ),
            "calculationModel": (
                "Sionna RT direct path only"
                if direct_only else "Sionna RT direct path + ground specular reflection"
            ),
        },
        "grids": {},
    }

    for alt in CFG.TERMINAL_ALTS_M:
        print(f"== {environment_label} 단말 고도 {alt} m 시뮬레이션 중...", flush=True)
        rmap = solver(
            scene,
            center=mi.Point3f(0.0, 0.0, float(alt)),
            orientation=mi.Point3f(0.0, 0.0, 0.0),
            size=mi.Point2f(size, size),
            cell_size=mi.Point2f(cell, cell),
            samples_per_tx=samples,
            max_depth=max_depth,
            specular_reflection=not direct_only,
            diffuse_reflection=False,
        )

        centers = rmap.cell_centers
        try:
            c2 = np.array(dr.detach(centers), dtype=float)
        except TypeError:
            c2 = np.array(centers, dtype=float)
        c2 = c2.reshape(-1, 3)
        pg = np.array(dr.detach(rmap.path_gain), dtype=float).ravel()
        pr_dbm = CFG.TX_POWER_DBM + 10.0 * np.log10(np.maximum(pg, 1e-30))

        pts = []
        for i in range(len(c2)):
            la, lo, _ = enu_to_latlon(
                float(c2[i, 0]), float(c2[i, 1]), 0.0, bs_lat, bs_lon, 0.0
            )
            pts.append([round(la, 6), round(lo, 6), round(float(pr_dbm[i]), 1)])

        arr = np.asarray([p[2] for p in pts], dtype=float)
        stats = {
            "count": len(pts),
            "meanDbm": round(float(arr.mean()), 1),
            "minDbm": round(float(arr.min()), 1),
            "maxDbm": round(float(arr.max()), 1),
            "coveragePct": round(
                float((arr >= CFG.COVERAGE_THRESHOLD_DBM).mean() * 100.0), 1
            ),
        }
        result["grids"][str(alt)] = {"points": pts, "stats": stats}
        print(
            f"   셀 수 {stats['count']} / 평균 {stats['meanDbm']:.1f} dBm / "
            f"최소 {stats['minDbm']:.1f} / 최대 {stats['maxDbm']:.1f} / "
            f"수신 가능 {stats['coveragePct']:.1f}%",
            flush=True,
        )

    return result


def run(quick=False, free_space_only=False):
    bs_lat, bs_lon = CFG.bs_lat_lon()

    print(
        "기지국: "
        f"lat={bs_lat:.7f}, lon={bs_lon:.7f}, "
        f"안테나 고도={CFG.BS_ALT_M:.1f} m"
    )

    # ------------------------------------------------------------
    # 1. 안테나 패턴
    # ------------------------------------------------------------
    pattern = load_pattern(freq=CFG.FREQ_BAND)
    save_result(calculate_formula_result(pattern=pattern, quick=quick), FORMULA_OUTPUT_FILE)
    amp_v, amp_h, peak_scale = build_pattern_tables(pattern)
    rt.register_antenna_pattern(
        PATTERN_NAME,
        make_pattern_factory(amp_v, amp_h, peak_scale),
    )
    scene = create_scene()
    solver = rt.RadioMapSolver()
    free_space_result = solve_rt_result(
        scene, solver, pattern, quick=quick, direct_only=True
    )
    save_result(free_space_result, FREE_SPACE_OUTPUT_FILE)

    if not free_space_only:
        reflected_result = solve_rt_result(
            scene,
            solver,
            pattern,
            quick=quick,
            direct_only=bool(CFG.LOS_ONLY),
        )
        save_result(reflected_result, OUTPUT_FILE)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--quick",
        action="store_true",
        help="저해상도 빠른 검증 실행",
    )
    ap.add_argument(
        "--free-space-only",
        action="store_true",
        help="자유공간 비교 결과만 생성(Sionna RT 계산 생략)",
    )
    args = ap.parse_args()
    run(quick=args.quick, free_space_only=args.free_space_only)
