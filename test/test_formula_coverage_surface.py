"""Friis -100dBm 3D 경계면 결과 검증."""

import json
import math
import os


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
result_path = os.path.join(ROOT, "Data", "sionna", "friis_volume_surface.json")
with open(result_path, encoding="utf-8") as source:
    result = json.load(source)

meta = result["meta"]
triangles = result["trianglesEnuM"]
assert meta["tool"] == "Friis formula (Sionna not used)"
assert meta["thresholdDbm"] == -100.0
assert meta["triangleCount"] == len(triangles)
assert meta["triangleCount"] > 1000
assert meta["maximumBoundaryDistanceM"] > meta["minimumBoundaryDistanceM"] > 0

flat = [value for triangle in triangles for value in triangle]
assert len(flat) == meta["triangleCount"] * 9
assert all(math.isfinite(float(value)) for value in flat)
assert min(triangle[index] for triangle in triangles for index in (2, 5, 8)) >= 0

print("PASS: Friis -100dBm 3D 경계면 메타데이터와 좌표 검증")
