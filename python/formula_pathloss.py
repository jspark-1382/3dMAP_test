# -*- coding: utf-8 -*-
"""Sionna 없이 Friis 자유공간 Pathloss/RSRP 격자를 생성한다."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import os

import numpy as np

import sionna_config as CFG
from pattern_loader import load_pattern


OUTPUT_DIR = os.path.normpath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "Data", "sionna")
)
OUTPUT_FILE = os.path.join(OUTPUT_DIR, "formula_pathloss.json")

WGS84_A = 6378137.0
WGS84_E2 = 6.69437999014e-3
LIGHT_SPEED_MPS = 299792458.0


def enu_to_latlon(east_m, north_m, lat0, lon0):
    """기지국 기준 ENU 평면 오프셋을 위경도로 변환한다."""
    lat = math.radians(lat0)
    sin_lat = math.sin(lat)
    n_rad = WGS84_A / math.sqrt(1.0 - WGS84_E2 * sin_lat * sin_lat)
    m_rad = (
        WGS84_A * (1.0 - WGS84_E2)
        / (1.0 - WGS84_E2 * sin_lat * sin_lat) ** 1.5
    )
    out_lat = math.degrees(lat + north_m / m_rad)
    out_lon = lon0 + math.degrees(east_m / (n_rad * math.cos(lat)))
    return out_lat, out_lon


def periodic_interp_deg(query_deg, source_deg, source_values):
    """-180..180 주기 데이터를 경계에서 끊김 없이 보간한다."""
    query = ((np.asarray(query_deg, dtype=float) + 180.0) % 360.0) - 180.0
    source_deg = np.asarray(source_deg, dtype=float)
    source_values = np.asarray(source_values, dtype=float)
    deg_ext = np.concatenate([source_deg - 360.0, source_deg, source_deg + 360.0])
    value_ext = np.concatenate([source_values, source_values, source_values])
    return np.interp(query, deg_ext, value_ext)


def free_space_path_loss_db(distance_m, frequency_hz):
    """Friis 자유공간 경로손실을 dB로 반환한다."""
    distance = np.maximum(np.asarray(distance_m, dtype=float), 0.001)
    wavelength = LIGHT_SPEED_MPS / float(frequency_hz)
    return 20.0 * np.log10(4.0 * math.pi * distance / wavelength)


def calculate_result(pattern=None, quick=False):
    """
    Friis 자유공간 식과 측정 안테나 방향이득으로 절대 수신전력을 계산한다.

    FSPL[dB] = 20 log10(4*pi*d/lambda)
    Pr[dBm] = Pt[dBm] + Gt(theta,phi)[dBi] + Gr[dBi] - FSPL[dB]

    현재 수신 안테나는 Sionna 설정과 동일하게 등방성 0 dBi, 추가 손실 0 dB다.
    """
    if pattern is None:
        pattern = load_pattern(freq=CFG.FREQ_BAND)

    bs_lat, bs_lon = CFG.bs_lat_lon()
    size = 400.0 if quick else float(CFG.GRID_SIZE_M)
    cell = 40.0 if quick else float(CFG.CELL_SIZE_M)

    coords = np.arange(-size / 2.0 + cell / 2.0, size / 2.0, cell)
    east, north = np.meshgrid(coords, coords)
    east = east.ravel()
    north = north.ravel()

    theta_src = np.asarray(pattern["theta_deg"], dtype=float)
    vertical_src = np.asarray(pattern["vertical_gain_dbi"], dtype=float)
    phi_src = np.asarray(pattern["phi_deg"], dtype=float)
    horizontal_src = np.asarray(pattern["horizontal_gain_dbi"], dtype=float)
    peak_gain_dbi = float(pattern["max_gain_dbi"])

    result = {
        "meta": {
            "tool": "Friis formula (Sionna not used)",
            "generated": dt.datetime.now().isoformat(timespec="seconds"),
            "antennaModel": pattern["model"],
            "antennaConfiguration": pattern.get("configuration"),
            "antennaSourceFile": pattern.get("source_file"),
            "antennaSourceSheet": pattern.get("source_sheet"),
            "antennaPatternMode": "2D horizontal + 2D vertical -> separable 3D approximation",
            "frequencyMHz": int(CFG.FREQ_HZ / 1e6),
            "txPowerDbm": CFG.TX_POWER_DBM,
            "rxGainDbi": 0.0,
            "systemLossDb": 0.0,
            "antennaMaxGainDbi": round(peak_gain_dbi, 2),
            "horizontalMaxGainDbi": round(pattern["horizontal_max_gain_dbi"], 2),
            "verticalMaxGainDbi": round(pattern["vertical_max_gain_dbi"], 2),
            "antennaHeightM": CFG.BS_ALT_M,
            "antennaAzimuthOffsetDeg": CFG.ANTENNA_AZIMUTH_OFFSET_DEG,
            "bs": {"lat": round(bs_lat, 7), "lon": round(bs_lon, 7)},
            "gridSizeM": size,
            "cellSizeM": cell,
            "samplesPerTx": None,
            "maxDepth": 0,
            "losOnly": True,
            "altitudesM": list(CFG.TERMINAL_ALTS_M),
            "coverageThresholdDbm": CFG.COVERAGE_THRESHOLD_DBM,
            "sceneModel": "formula free space",
            "calculationModel": "Friis FSPL + dual Yagi/omni measured separable antenna gain",
        },
        "grids": {},
    }

    for alt in CFG.TERMINAL_ALTS_M:
        up = float(alt) - float(CFG.BS_ALT_M)
        distance_m = np.sqrt(east * east + north * north + up * up)
        distance_m = np.maximum(distance_m, 0.001)

        theta_deg = np.degrees(np.arccos(np.clip(up / distance_m, -1.0, 1.0)))
        phi_deg = np.degrees(np.arctan2(north, east))
        phi_query = phi_deg - float(CFG.ANTENNA_AZIMUTH_OFFSET_DEG)

        vertical_gain = np.interp(theta_deg, theta_src, vertical_src)
        horizontal_gain = periodic_interp_deg(phi_query, phi_src, horizontal_src)
        tx_gain_dbi = (
            peak_gain_dbi
            + (vertical_gain - np.max(vertical_src))
            + (horizontal_gain - np.max(horizontal_src))
        )
        fspl_db = free_space_path_loss_db(distance_m, CFG.FREQ_HZ)
        received_dbm = float(CFG.TX_POWER_DBM) + tx_gain_dbi - fspl_db

        points = []
        for i in range(len(east)):
            lat, lon = enu_to_latlon(float(east[i]), float(north[i]), bs_lat, bs_lon)
            points.append([round(lat, 6), round(lon, 6), round(float(received_dbm[i]), 1)])

        stats = {
            "count": len(points),
            "meanDbm": round(float(received_dbm.mean()), 1),
            "minDbm": round(float(received_dbm.min()), 1),
            "maxDbm": round(float(received_dbm.max()), 1),
            "coveragePct": round(
                float((received_dbm >= CFG.COVERAGE_THRESHOLD_DBM).mean() * 100.0), 1
            ),
        }
        result["grids"][str(alt)] = {"points": points, "stats": stats}
        print(
            f"== Friis 수식 {alt} m: 평균 {stats['meanDbm']:.1f} dBm / "
            f"최소 {stats['minDbm']:.1f} / 최대 {stats['maxDbm']:.1f}",
            flush=True,
        )

    return result


def save_result(result, path=OUTPUT_FILE):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as output:
        json.dump(result, output, ensure_ascii=False)
    print(f"저장 완료: {path} ({os.path.getsize(path) / 1024.0:.1f} KB)")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--quick", action="store_true", help="저해상도 빠른 검증 실행")
    args = parser.parse_args()
    save_result(calculate_result(quick=args.quick))


if __name__ == "__main__":
    main()
