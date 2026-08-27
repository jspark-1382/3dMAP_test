# -*- coding: utf-8 -*-
"""260827 이중 야기+옴니 패턴 입력과 기지국 좌표 검증."""

from __future__ import annotations

import os
import sys
import unittest


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "python"))
PATTERN_SOURCE = os.path.join(ROOT, "Data", "pattern", "260827_pattern.xlsx")

import sionna_config as config
from pattern_loader import load_pattern


class PatternLoaderTest(unittest.TestCase):
    @unittest.skipUnless(os.path.exists(PATTERN_SOURCE), "로컬 안테나 패턴 원본이 없습니다.")
    def test_combined_sheet_is_loaded(self):
        pattern = load_pattern()
        self.assertEqual(pattern["source_file"], "260827_pattern.xlsx")
        self.assertEqual(pattern["source_sheet"], "야기+옴니")
        self.assertEqual(pattern["configuration"], "dual Yagi + omni")
        self.assertEqual(pattern["freq_mhz"], 910)
        self.assertEqual(len(pattern["theta_deg"]), 181)
        self.assertEqual(len(pattern["phi_deg"]), 361)
        self.assertAlmostEqual(pattern["max_gain_dbi"], 7.2111014212, places=6)

    @unittest.skipUnless(os.path.exists(PATTERN_SOURCE), "로컬 안테나 패턴 원본이 없습니다.")
    def test_each_analysis_pattern_sheet_is_selectable(self):
        expected = {
            "야기안테나": "야기 안테나 (260827)",
            "옴니": "옴니 안테나 (260827)",
            "야기+옴니": "이중 야기 + 옴니 (260827)",
        }
        for sheet_name, model in expected.items():
            pattern = load_pattern(sheet_name=sheet_name)
            self.assertEqual(pattern["source_sheet"], sheet_name)
            self.assertEqual(pattern["model"], model)
            self.assertEqual(len(pattern["theta_deg"]), 181)
            self.assertEqual(len(pattern["phi_deg"]), 361)

    def test_base_station_coordinates_are_exact(self):
        latitude, longitude = config.bs_lat_lon()
        self.assertEqual(latitude, 34.6126944)
        self.assertEqual(longitude, 127.2059722)


if __name__ == "__main__":
    unittest.main()
