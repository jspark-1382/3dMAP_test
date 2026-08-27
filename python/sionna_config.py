# ============================================================
# Sionna RT 커버리지 시뮬레이션 설정
# ============================================================

# ---- 기지국 위치: 34°36'45.7"N 127°12'21.5"E ----
BS_LAT_DMS = (34, 36, 45.7)
BS_LON_DMS = (127, 12, 21.5)
BS_ALT_M = 16.0

# ---- 주파수 / 전력 ----
FREQ_BAND = "910"       # "910" 또는 "955"
FREQ_HZ = 910e6
TX_POWER_DBM = 21.0

# ---- 안테나 ----
# CSV의 '수평' = 수평면(Azimuth) 방사 패턴
# CSV의 '수직' = 수직면(Elevation) 방사 패턴
#
# 현재는 2개의 2D cut으로 3D 패턴을 근사한다.
# 추후 드론 실측 데이터가 생기면 별도의 3D correction을 이 패턴 위에 적용한다.
ANTENNA_PATTERN_RES_DEG = 0.25

# 패턴의 방위각 기준 방향을 실제 설치 방향에 맞추고 싶을 때 사용.
# 옴니 계열이라 현재 영향은 크지 않다.
ANTENNA_AZIMUTH_OFFSET_DEG = 0.0

# ---- 시뮬레이션 격자 ----
GRID_SIZE_M = 3000.0
CELL_SIZE_M = 20.0
TERMINAL_ALTS_M = [100, 200, 300, 400, 500, 1000, 2000]

# ---- 레이트레이싱 ----
MAX_DEPTH = 7
NUM_SAMPLES = 5_000_000

# True: 직접파(LoS)만 사용
# False: 직접파 + 지면 specular reflection
LOS_ONLY = False

# ---- 커버리지 판정 ----
COVERAGE_THRESHOLD_DBM = -100.0


def bs_lat_lon():
    """DMS -> decimal degrees."""
    lat = BS_LAT_DMS[0] + BS_LAT_DMS[1] / 60.0 + BS_LAT_DMS[2] / 3600.0
    lon = BS_LON_DMS[0] + BS_LON_DMS[1] / 60.0 + BS_LON_DMS[2] / 3600.0
    return lat, lon
