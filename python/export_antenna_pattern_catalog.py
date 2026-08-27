# -*- coding: utf-8 -*-
"""방사 패턴 분석 화면용 로컬 패턴 카탈로그를 생성한다.

출력 JSON은 원본 측정 패턴을 포함하므로 Git에는 올리지 않는다.
"""

from __future__ import annotations

import datetime as dt
import json
import os

import numpy as np

import sionna_config as CFG
from pattern_loader import DEFAULT_PATTERN_PATH, load_pattern


OUTPUT_FILE = os.path.normpath(os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "..", "Data", "sionna", "antenna_pattern_catalog.json",
))

SHEETS = (
    ("yagi", "야기안테나", "야기 단독"),
    ("omni", "옴니", "옴니 단독"),
    ("combined", "야기+옴니", "이중 야기 + 옴니"),
)


def _close_cut(angles, horizontal, vertical):
    angles = list(angles)
    horizontal = list(horizontal)
    vertical = list(vertical)
    if angles and angles[-1] < 360.0:
        angles.append(360.0)
        horizontal.append(horizontal[0])
        vertical.append(vertical[0])
    return angles, horizontal, vertical


def build_entry(key, sheet_name, label):
    pattern = load_pattern(sheet_name=sheet_name, freq=CFG.FREQ_BAND)
    angles, raw_h, raw_v = _close_cut(
        pattern["raw_angle_deg"],
        pattern["raw_horizontal_gain_dbi"],
        pattern["raw_vertical_gain_dbi"],
    )
    raw_h = np.asarray(raw_h, dtype=float)
    raw_v = np.asarray(raw_v, dtype=float)
    cut_peak = float(max(np.max(raw_h), np.max(raw_v)))
    horizontal = np.asarray(pattern["horizontal_gain_dbi"], dtype=float)
    vertical = np.asarray(pattern["vertical_gain_dbi"], dtype=float)
    return key, {
        "label": label,
        "model": pattern["model"],
        "sourceSheet": sheet_name,
        "frequencyMHz": pattern["freq_mhz"],
        "maxGainDbi": round(float(pattern["max_gain_dbi"]), 4),
        "cutAngleDeg": angles,
        "horizontalCutRelativeGainDb": (raw_h - cut_peak).round(4).tolist(),
        "verticalCutRelativeGainDb": (raw_v - cut_peak).round(4).tolist(),
        "thetaDeg": pattern["theta_deg"],
        "vertical3dRelativeGainDb": (vertical - np.max(vertical)).round(4).tolist(),
        "phiDeg": pattern["phi_deg"],
        "horizontal3dRelativeGainDb": (horizontal - np.max(horizontal)).round(4).tolist(),
    }


def build_catalog():
    patterns = dict(build_entry(*definition) for definition in SHEETS)
    return {
        "meta": {
            "generated": dt.datetime.now().isoformat(timespec="seconds"),
            "sourceFile": os.path.basename(DEFAULT_PATTERN_PATH),
            "frequencyMHz": int(CFG.FREQ_HZ / 1e6),
            "bs": {"lat": CFG.bs_lat_lon()[0], "lon": CFG.bs_lat_lon()[1]},
            "note": "local-only measured antenna pattern catalog",
        },
        "patterns": patterns,
    }


def main():
    os.makedirs(os.path.dirname(OUTPUT_FILE), exist_ok=True)
    with open(OUTPUT_FILE, "w", encoding="utf-8") as output:
        json.dump(build_catalog(), output, ensure_ascii=False, separators=(",", ":"))
    print(f"저장 완료: {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
