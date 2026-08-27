# -*- coding: utf-8 -*-
"""실행: python test/test_formula_pathloss.py"""

import math
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "python"))

from formula_pathloss import free_space_path_loss_db


def near(actual, expected, tolerance, label):
    if abs(float(actual) - float(expected)) > tolerance:
        raise AssertionError(f"{label}: {actual} != {expected}")
    print(f"PASS: {label}")


# 1 km, 910 MHz: 32.44 + 20log10(910) + 20log10(1) ~= 91.63 dB
expected_1km = 32.4478 + 20.0 * math.log10(910.0)
near(free_space_path_loss_db(1000.0, 910e6), expected_1km, 0.02, "1km / 910MHz FSPL")

# 거리 2배면 정확히 6.0206 dB 증가한다.
loss_1km = float(free_space_path_loss_db(1000.0, 910e6))
loss_2km = float(free_space_path_loss_db(2000.0, 910e6))
near(loss_2km - loss_1km, 20.0 * math.log10(2.0), 1e-9, "거리 2배 손실 증가")
