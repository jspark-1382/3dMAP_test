# -*- coding: utf-8 -*-
"""Friis 자유공간 식으로 RSRP 임계 3D 경계면 메시를 생성한다.

Sionna를 사용하지 않으며 측정 H/V 안테나 패턴을 separable 3D로 합성한다.
출력: Data/sionna/friis_volume_surface.json
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import os

import numpy as np

import sionna_config as CFG
from formula_pathloss import LIGHT_SPEED_MPS, periodic_interp_deg
from pattern_loader import load_pattern


OUTPUT_FILE = os.path.normpath(
    os.path.join(
        os.path.dirname(os.path.abspath(__file__)),
        "..",
        "Data",
        "sionna",
        "friis_volume_surface.json",
    )
)


def boundary_distance_m(tx_gain_dbi, threshold_dbm):
    """Friis 식을 역으로 풀어 임계 RSRP가 되는 3차원 거리를 구한다."""
    allowed_path_loss_db = (
        float(CFG.TX_POWER_DBM) + np.asarray(tx_gain_dbi, dtype=float)
        - float(threshold_dbm)
    )
    wavelength_m = LIGHT_SPEED_MPS / float(CFG.FREQ_HZ)
    return wavelength_m / (4.0 * math.pi) * np.power(10.0, allowed_path_loss_db / 20.0)


def clip_triangle_above_ground(triangle):
    """삼각형을 ENU up=0 평면 위로 잘라 0~2개 삼각형으로 반환한다."""
    polygon = []
    previous = np.asarray(triangle[-1], dtype=float)
    previous_inside = previous[2] >= 0.0
    for raw_current in triangle:
        current = np.asarray(raw_current, dtype=float)
        current_inside = current[2] >= 0.0
        if current_inside != previous_inside:
            ratio = (0.0 - previous[2]) / (current[2] - previous[2])
            crossing = previous + (current - previous) * ratio
            crossing[2] = 0.0
            polygon.append(crossing)
        if current_inside:
            polygon.append(current)
        previous = current
        previous_inside = current_inside

    if len(polygon) < 3:
        return []
    return [
        (polygon[0], polygon[index], polygon[index + 1])
        for index in range(1, len(polygon) - 1)
    ]


def non_degenerate(triangle):
    a, b, c = (np.asarray(point, dtype=float) for point in triangle)
    return float(np.linalg.norm(np.cross(b - a, c - a))) > 1e-5


def build_surface(pattern, threshold_dbm=-100.0, az_step_deg=3.0, theta_step_deg=2.0):
    """방향별 Friis 임계거리로 지면 위의 연속 3D 경계면을 만든다."""
    phis = np.arange(-180.0, 180.0, float(az_step_deg), dtype=float)
    thetas = np.arange(0.0, 180.0 + 1e-6, float(theta_step_deg), dtype=float)

    vertical_source = np.asarray(pattern["vertical_gain_dbi"], dtype=float)
    horizontal_source = np.asarray(pattern["horizontal_gain_dbi"], dtype=float)
    vertical_relative = vertical_source - np.max(vertical_source)
    horizontal_relative = horizontal_source - np.max(horizontal_source)
    peak_gain_dbi = float(pattern["max_gain_dbi"])

    vertices = []
    all_distances = []
    for phi_deg in phis:
        horizontal_gain = float(periodic_interp_deg(
            [phi_deg - float(CFG.ANTENNA_AZIMUTH_OFFSET_DEG)],
            pattern["phi_deg"],
            horizontal_relative,
        )[0])
        vertical_gain = np.interp(thetas, pattern["theta_deg"], vertical_relative)
        tx_gain = peak_gain_dbi + vertical_gain + horizontal_gain
        distance = boundary_distance_m(tx_gain, threshold_dbm)
        all_distances.extend(distance.tolist())

        theta_rad = np.radians(thetas)
        phi_rad = math.radians(phi_deg)
        horizontal = distance * np.sin(theta_rad)
        east = horizontal * math.cos(phi_rad)
        north = horizontal * math.sin(phi_rad)
        up = float(CFG.BS_ALT_M) + distance * np.cos(theta_rad)
        vertices.append(np.column_stack((east, north, up)))

    triangles = []
    az_count = len(phis)
    theta_count = len(thetas)
    for az_index in range(az_count):
        next_az = (az_index + 1) % az_count
        for theta_index in range(theta_count - 1):
            quad_triangles = (
                (
                    vertices[az_index][theta_index],
                    vertices[next_az][theta_index],
                    vertices[az_index][theta_index + 1],
                ),
                (
                    vertices[az_index][theta_index + 1],
                    vertices[next_az][theta_index],
                    vertices[next_az][theta_index + 1],
                ),
            )
            for triangle in quad_triangles:
                for clipped in clip_triangle_above_ground(triangle):
                    if not non_degenerate(clipped):
                        continue
                    triangles.append([
                        round(float(value), 3)
                        for point in clipped
                        for value in point
                    ])

    flat_points = np.asarray(triangles, dtype=float).reshape(-1, 3)
    bs_lat, bs_lon = CFG.bs_lat_lon()
    return {
        "meta": {
            "tool": "Friis formula (Sionna not used)",
            "generated": dt.datetime.now().isoformat(timespec="seconds"),
            "calculation": "analytical RSRP threshold distance by azimuth/elevation",
            "environment": "free space",
            "frequencyMHz": int(CFG.FREQ_HZ / 1e6),
            "txPowerDbm": CFG.TX_POWER_DBM,
            "antennaModel": pattern["model"],
            "antennaConfiguration": pattern.get("configuration"),
            "antennaSourceFile": pattern.get("source_file"),
            "antennaSourceSheet": pattern.get("source_sheet"),
            "antennaMaxGainDbi": peak_gain_dbi,
            "thresholdDbm": float(threshold_dbm),
            "azimuthStepDeg": float(az_step_deg),
            "thetaStepDeg": float(theta_step_deg),
            "bs": {"lat": bs_lat, "lon": bs_lon},
            "antennaHeightM": CFG.BS_ALT_M,
            "triangleCount": len(triangles),
            "minimumBoundaryDistanceM": round(float(np.min(all_distances)), 1),
            "maximumBoundaryDistanceM": round(float(np.max(all_distances)), 1),
            "maximumAltitudeM": round(float(np.max(flat_points[:, 2])), 1),
            "boundaryReached": {
                "west": False,
                "east": False,
                "south": False,
                "north": False,
                "top": False,
                "bottom": True,
            },
        },
        "trianglesEnuM": triangles,
    }


def save_result(result, path=OUTPUT_FILE):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as output:
        json.dump(result, output, ensure_ascii=False, separators=(",", ":"))
    print(
        f"저장 완료: {path} · {result['meta']['triangleCount']:,} triangles · "
        f"{os.path.getsize(path) / 1024 / 1024:.1f}MB"
    )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--threshold-dbm", type=float, default=-100.0)
    parser.add_argument("--az-step-deg", type=float, default=3.0)
    parser.add_argument("--theta-step-deg", type=float, default=2.0)
    args = parser.parse_args()
    pattern = load_pattern(freq=CFG.FREQ_BAND)
    save_result(build_surface(
        pattern,
        threshold_dbm=args.threshold_dbm,
        az_step_deg=args.az_step_deg,
        theta_step_deg=args.theta_step_deg,
    ))


if __name__ == "__main__":
    main()
