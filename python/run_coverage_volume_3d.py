# -*- coding: utf-8 -*-
"""별도 Sionna RT 3D 격자에서 RSRP 임계 등가면 메시를 생성한다.

기존 고도별 결과 파일은 수정하지 않는다.
출력: Data/sionna/sionna_volume_surface.json
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import os

import drjit as dr
import mitsuba as mi
import numpy as np
import sionna.rt as rt
from scipy.ndimage import binary_opening, gaussian_filter, label

import sionna_config as CFG
from pattern_loader import load_pattern
from run_coverage import (
    GROUND_XML_FMT,
    PATTERN_NAME,
    SOIL_CONDUCTIVITY,
    SOIL_PERMITTIVITY,
    build_pattern_tables,
    make_pattern_factory,
)


OUTPUT_FILE = os.path.normpath(
    os.path.join(
        os.path.dirname(os.path.abspath(__file__)),
        "..",
        "Data",
        "sionna",
        "sionna_volume_surface.json",
    )
)


# 한 cube를 6개의 tetrahedron으로 나누는 인덱스
CUBE_TETS = (
    (0, 5, 1, 6),
    (0, 1, 2, 6),
    (0, 2, 3, 6),
    (0, 3, 7, 6),
    (0, 7, 4, 6),
    (0, 4, 5, 6),
)
TET_EDGES = ((0, 1), (1, 2), (2, 0), (0, 3), (1, 3), (2, 3))


def create_volume_scene(half_extent_m: float):
    """3D 계산 범위를 충분히 덮는 별도 평탄 지면 장면."""
    scene = rt.load_scene_from_string(
        GROUND_XML_FMT.format(
            s=max(8000.0, half_extent_m * 1.25),
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
    scene.add(
        rt.Transmitter(
            name="bs",
            position=mi.Point3f(0.0, 0.0, CFG.BS_ALT_M),
            power_dbm=CFG.TX_POWER_DBM,
        )
    )
    return scene


def altitude_grid(max_alt_m: float, alt_step_m: float):
    """지면 부근 형상을 보존하고 상부는 일정 간격으로 계산한다."""
    values = [100.0, 500.0, 1000.0]
    current = max(2000.0, alt_step_m)
    while current <= max_alt_m + 1e-6:
        values.append(float(current))
        current += alt_step_m
    return np.asarray(sorted(set(v for v in values if v <= max_alt_m)), dtype=float)


def simulate_volume(
    size_m: float,
    cell_m: float,
    max_alt_m: float,
    alt_step_m: float,
    samples: int,
    reflected: bool,
):
    """Sionna RadioMapSolver를 여러 고도에 실행해 RSRP 3D 배열을 만든다."""
    pattern = load_pattern(freq=CFG.FREQ_BAND)
    amp_v, amp_h, peak_scale = build_pattern_tables(pattern)
    try:
        rt.register_antenna_pattern(
            PATTERN_NAME,
            make_pattern_factory(amp_v, amp_h, peak_scale),
        )
    except ValueError:
        # 동일 프로세스에서 재실행할 때 이미 등록된 경우
        pass

    scene = create_volume_scene(size_m / 2.0)
    solver = rt.RadioMapSolver()
    altitudes = altitude_grid(max_alt_m, alt_step_m)
    slices = []
    east = north = None

    for index, altitude in enumerate(altitudes):
        print(
            f"[{index + 1}/{len(altitudes)}] Sionna 3D 고도 {altitude:.0f}m 계산 중...",
            flush=True,
        )
        rmap = solver(
            scene,
            center=mi.Point3f(0.0, 0.0, float(altitude)),
            orientation=mi.Point3f(0.0, 0.0, 0.0),
            size=mi.Point2f(size_m, size_m),
            cell_size=mi.Point2f(cell_m, cell_m),
            samples_per_tx=int(samples),
            max_depth=1 if reflected else 0,
            specular_reflection=bool(reflected),
            diffuse_reflection=False,
        )
        centers = np.asarray(dr.detach(rmap.cell_centers), dtype=float).reshape(-1, 3)
        gain = np.asarray(dr.detach(rmap.path_gain), dtype=float).ravel()
        received = CFG.TX_POWER_DBM + 10.0 * np.log10(np.maximum(gain, 1e-30))

        side = int(round(math.sqrt(len(received))))
        if side * side != len(received):
            raise RuntimeError("Sionna radio map이 정사각 격자가 아닙니다.")
        slices.append(received.reshape(side, side).astype(np.float32))
        if east is None:
            east = centers[:, 0].reshape(side, side)[0, :].astype(np.float32)
            north = centers[:, 1].reshape(side, side)[:, 0].astype(np.float32)

        above = float(np.mean(received >= CFG.COVERAGE_THRESHOLD_DBM) * 100.0)
        print(
            f"    {side}x{side} · {received.min():.1f}~{received.max():.1f}dBm "
            f"· 기준 이상 {above:.1f}%",
            flush=True,
        )

    return east, north, altitudes.astype(np.float32), np.stack(slices), pattern


def interpolate_edge(point_a, point_b, value_a, value_b, threshold):
    if value_a == value_b:
        ratio = 0.5
    else:
        ratio = float((threshold - value_a) / (value_b - value_a))
    ratio = min(1.0, max(0.0, ratio))
    return point_a + (point_b - point_a) * ratio


def triangulate_tetra(points, values, threshold):
    """한 tetrahedron의 임계면을 1~2개 삼각형으로 반환한다."""
    inside = values >= threshold
    if bool(np.all(inside)) or not bool(np.any(inside)):
        return []

    intersections = []
    for edge_a, edge_b in TET_EDGES:
        if bool(inside[edge_a]) == bool(inside[edge_b]):
            continue
        intersections.append(
            interpolate_edge(
                points[edge_a],
                points[edge_b],
                values[edge_a],
                values[edge_b],
                threshold,
            )
        )
    if len(intersections) == 3:
        return [(intersections[0], intersections[1], intersections[2])]
    if len(intersections) != 4:
        return []

    # 네 교차점은 한 평면의 사각형이다. 중심 둘레로 정렬한 뒤 두 삼각형으로 나눈다.
    quad = np.asarray(intersections, dtype=np.float64)
    center = quad.mean(axis=0)
    normal = np.cross(quad[1] - quad[0], quad[2] - quad[0])
    normal_len = np.linalg.norm(normal)
    if normal_len < 1e-9:
        return []
    normal /= normal_len
    axis_u = quad[0] - center
    axis_u_len = np.linalg.norm(axis_u)
    if axis_u_len < 1e-9:
        return []
    axis_u /= axis_u_len
    axis_v = np.cross(normal, axis_u)
    angles = np.arctan2((quad - center) @ axis_v, (quad - center) @ axis_u)
    quad = quad[np.argsort(angles)]
    return [(quad[0], quad[1], quad[2]), (quad[0], quad[2], quad[3])]


def extract_surface(east, north, altitudes, volume_dbm, threshold):
    """marching tetrahedra로 RSRP 임계 등가면을 추출한다."""
    triangles = []
    nz, ny, nx = volume_dbm.shape
    for iz in range(nz - 1):
        print(f"    등가면 추출 {iz + 1}/{nz - 1}", flush=True)
        z0, z1 = float(altitudes[iz]), float(altitudes[iz + 1])
        for iy in range(ny - 1):
            y0, y1 = float(north[iy]), float(north[iy + 1])
            for ix in range(nx - 1):
                x0, x1 = float(east[ix]), float(east[ix + 1])
                cube_points = np.asarray(
                    [
                        (x0, y0, z0),
                        (x1, y0, z0),
                        (x1, y1, z0),
                        (x0, y1, z0),
                        (x0, y0, z1),
                        (x1, y0, z1),
                        (x1, y1, z1),
                        (x0, y1, z1),
                    ],
                    dtype=np.float64,
                )
                cube_values = np.asarray(
                    [
                        volume_dbm[iz, iy, ix],
                        volume_dbm[iz, iy, ix + 1],
                        volume_dbm[iz, iy + 1, ix + 1],
                        volume_dbm[iz, iy + 1, ix],
                        volume_dbm[iz + 1, iy, ix],
                        volume_dbm[iz + 1, iy, ix + 1],
                        volume_dbm[iz + 1, iy + 1, ix + 1],
                        volume_dbm[iz + 1, iy + 1, ix],
                    ],
                    dtype=np.float64,
                )
                if np.all(cube_values >= threshold) or np.all(cube_values < threshold):
                    continue
                for tet in CUBE_TETS:
                    triangles.extend(
                        triangulate_tetra(
                            cube_points[list(tet)],
                            cube_values[list(tet)],
                            threshold,
                        )
                    )

    # 렌더링 단순화를 위해 삼각형별 좌표를 1m 단위 정수로 저장한다.
    packed = []
    for triangle in triangles:
        packed.append(
            [int(round(value)) for point in triangle for value in point]
        )
    return packed


def boundary_flags(volume, threshold):
    covered = volume >= threshold
    return {
        "west": bool(np.any(covered[:, :, 0])),
        "east": bool(np.any(covered[:, :, -1])),
        "south": bool(np.any(covered[:, 0, :])),
        "north": bool(np.any(covered[:, -1, :])),
        "top": bool(np.any(covered[-1, :, :])),
        "bottom": bool(np.any(covered[0, :, :])),
    }


def boundary_details(volume, threshold):
    sides = {
        "west": volume[:, :, 0],
        "east": volume[:, :, -1],
        "south": volume[:, 0, :],
        "north": volume[:, -1, :],
        "top": volume[-1, :, :],
    }
    return {
        name: {
            "maxDbm": round(float(values.max()), 1),
            "coveredCells": int(np.count_nonzero(values >= threshold)),
        }
        for name, values in sides.items()
    }


def smooth_volume_power(volume_dbm):
    """RadioMap 표본 잡음을 선형 전력 공간에서 완화해 연속 등가면을 만든다."""
    power_mw = np.power(10.0, np.asarray(volume_dbm, dtype=np.float64) / 10.0)
    smoothed_mw = gaussian_filter(power_mw, sigma=(0.65, 0.9, 0.9), mode="nearest")
    return (10.0 * np.log10(np.maximum(smoothed_mw, 1e-30))).astype(np.float32)


def keep_main_coverage_component(volume_dbm, threshold):
    """희소한 ray 표본으로 생긴 외곽 단독 점을 제거하고 주 커버리지 덩어리만 유지한다."""
    covered = volume_dbm >= threshold
    opened = binary_opening(
        covered,
        structure=np.ones((1, 3, 3), dtype=bool),
    )
    labels, count = label(opened)
    if count == 0:
        return volume_dbm
    counts = np.bincount(labels.ravel())
    counts[0] = 0
    main_label = int(np.argmax(counts))
    main = labels == main_label
    filtered = np.asarray(volume_dbm, dtype=np.float32).copy()
    filtered[~main] = np.minimum(filtered[~main], threshold - 1.0)
    return filtered


def run(args):
    east, north, altitudes, volume, pattern = simulate_volume(
        size_m=args.size_m,
        cell_m=args.cell_m,
        max_alt_m=args.max_alt_m,
        alt_step_m=args.alt_step_m,
        samples=args.samples,
        reflected=not args.direct_only,
    )
    print("Sionna 3D 격자를 선형 전력 공간에서 연속 보간 중...", flush=True)
    surface_volume = keep_main_coverage_component(
        smooth_volume_power(volume),
        args.threshold_dbm,
    )
    print(f"RSRP {args.threshold_dbm:.1f}dBm 등가면 추출 중...", flush=True)
    triangles = extract_surface(east, north, altitudes, surface_volume, args.threshold_dbm)
    flags = boundary_flags(surface_volume, args.threshold_dbm)
    details = boundary_details(surface_volume, args.threshold_dbm)
    result = {
        "meta": {
            "tool": f"Sionna RT {rt.__version__}",
            "generated": dt.datetime.now().isoformat(timespec="seconds"),
            "calculation": "independent 3D radio-map slices + marching tetrahedra isosurface",
            "surfaceInterpolation": "Gaussian averaging in linear-power domain, sigma=(z 0.65, y 0.9, x 0.9)",
            "surfaceTopology": "largest connected coverage body after 3x3 horizontal opening",
            "environment": "direct + flat-ground reflection" if not args.direct_only else "direct only",
            "frequencyMHz": int(CFG.FREQ_HZ / 1e6),
            "txPowerDbm": CFG.TX_POWER_DBM,
            "antennaModel": pattern["model"],
            "antennaMaxGainDbi": pattern["max_gain_dbi"],
            "thresholdDbm": args.threshold_dbm,
            "horizontalSizeM": args.size_m,
            "horizontalCellM": args.cell_m,
            "altitudesM": [int(round(value)) for value in altitudes],
            "samplesPerSlice": args.samples,
            "boundaryReached": flags,
            "boundaryDetails": details,
            "bs": {"lat": CFG.bs_lat_lon()[0], "lon": CFG.bs_lat_lon()[1]},
            "antennaHeightM": CFG.BS_ALT_M,
            "triangleCount": len(triangles),
        },
        "trianglesEnuM": triangles,
    }
    os.makedirs(os.path.dirname(OUTPUT_FILE), exist_ok=True)
    with open(OUTPUT_FILE, "w", encoding="utf-8") as output:
        json.dump(result, output, ensure_ascii=False, separators=(",", ":"))
    print(
        f"저장 완료: {OUTPUT_FILE} · {len(triangles):,} triangles · "
        f"{os.path.getsize(OUTPUT_FILE) / 1024 / 1024:.1f}MB",
        flush=True,
    )
    print("계산 경계 도달:", flags, flush=True)
    print("계산 경계 상세:", details, flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--size-m", type=float, default=160000.0)
    parser.add_argument("--cell-m", type=float, default=2000.0)
    parser.add_argument("--max-alt-m", type=float, default=40000.0)
    parser.add_argument("--alt-step-m", type=float, default=2000.0)
    parser.add_argument("--samples", type=int, default=800000)
    parser.add_argument("--threshold-dbm", type=float, default=-100.0)
    parser.add_argument("--direct-only", action="store_true")
    args = parser.parse_args()
    run(args)


if __name__ == "__main__":
    main()
