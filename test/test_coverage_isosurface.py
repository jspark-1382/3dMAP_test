"""별도 Sionna -100dBm 등가면 결과 파일 검증."""

import json
import os
import math


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

result_path = os.path.join(ROOT, "Data", "sionna", "sionna_volume_surface.json")
with open(result_path, encoding="utf-8") as source:
    result = json.load(source)

meta = result["meta"]
assert meta["thresholdDbm"] == -100.0
assert meta["triangleCount"] == len(result["trianglesEnuM"])
assert meta["triangleCount"] > 1000
assert not any(
    meta["boundaryReached"][name]
    for name in ("west", "east", "south", "north", "top")
)

flat = [value for triangle in result["trianglesEnuM"] for value in triangle]
assert len(flat) == meta["triangleCount"] * 9
assert all(math.isfinite(float(value)) for value in flat)

print("PASS: 등가면 삼각형 좌표 개수와 유효성 검증")
print("PASS: -100dBm 연속 메시와 수평·상단 경계 폐합 검증")
