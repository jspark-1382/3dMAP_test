# -*- coding: utf-8 -*-
"""측정 H/V 안테나 패턴을 브라우저용 JSON으로 내보낸다."""

from __future__ import annotations

import json
import os

import numpy as np

import sionna_config as CFG
from pattern_loader import load_pattern


OUTPUT_FILE = os.path.normpath(
    os.path.join(
        os.path.dirname(os.path.abspath(__file__)),
        "..",
        "Data",
        "sionna",
        "antenna_pattern.json",
    )
)


def build_export(pattern=None):
    if pattern is None:
        pattern = load_pattern(freq=CFG.FREQ_BAND)

    vertical = np.asarray(pattern["vertical_gain_dbi"], dtype=float)
    horizontal = np.asarray(pattern["horizontal_gain_dbi"], dtype=float)
    vertical_relative = vertical - np.max(vertical)
    horizontal_relative = horizontal - np.max(horizontal)

    return {
        "model": pattern["model"],
        "configuration": pattern.get("configuration", "dual Yagi + omni"),
        "sourceFile": pattern.get("source_file"),
        "sourceSheet": pattern.get("source_sheet"),
        "frequencyMHz": pattern["freq_mhz"],
        "maxGainDbi": round(float(pattern["max_gain_dbi"]), 3),
        "approximation": "dual Yagi + omni measured H/V separable 3D",
        "bs": {"lat": CFG.bs_lat_lon()[0], "lon": CFG.bs_lat_lon()[1]},
        "thetaDeg": pattern["theta_deg"],
        "relativeGainDb": vertical_relative.round(4).tolist(),
        "verticalRelativeGainDb": vertical_relative.round(4).tolist(),
        "phiDeg": pattern["phi_deg"],
        "horizontalRelativeGainDb": horizontal_relative.round(4).tolist(),
    }


def main():
    result = build_export()
    os.makedirs(os.path.dirname(OUTPUT_FILE), exist_ok=True)
    with open(OUTPUT_FILE, "w", encoding="utf-8") as output:
        json.dump(result, output, ensure_ascii=False)
    print(f"저장 완료: {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
