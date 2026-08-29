# ============================================================
# Sionna RT 커버리지 시뮬레이션 설정
# ============================================================

# ---- 기지국 위치: 사용자 지정 십진 좌표 ----
BS_LAT = 34.6126944
BS_LON = 127.2059722

# 참고용 DMS 표기: 34°36'45.7"N 127°12'21.5"E
BS_LAT_DMS = (34, 36, 45.7)
BS_LON_DMS = (127, 12, 21.5)
BS_ALT_M = 16.0

# ---- LTE 주파수 / 전력 기준 ----
FREQ_BAND = "955"       # "910" 또는 "955"
FREQ_HZ = 955e6
BANDWIDTH_MHZ = 10.0
NUMBER_OF_RB = 50
SUBCARRIERS = 600

# 송신기 전체 출력. Sionna 장면의 송신기 설정에 사용한다.
TOTAL_TX_POWER_DBM = 21.0
TX_POWER_DBM = TOTAL_TX_POWER_DBM  # 기존 계산 코드와의 호환 이름

# RSRP는 전체 대역 출력이 아니라 기준신호 RE 전력을 기준으로 계산한다.
# 사용자가 제공한 장비 입력값을 우선 적용한다.
BASE_RE_POWER_DBM = 18.22
RS_POWER_OFFSET_DB = 0.0
RSRP_REFERENCE_POWER_DBM = BASE_RE_POWER_DBM + RS_POWER_OFFSET_DB
CABLE_LOSS_DB = 1.0
SYSTEM_LOSS_DB = CABLE_LOSS_DB


def link_budget_metadata():
    """모든 결과 파일이 공유하는 LTE/RSRP 입력값."""
    return {
        "frequencyMHz": int(FREQ_HZ / 1e6),
        "bandwidthMHz": BANDWIDTH_MHZ,
        "numberOfResourceBlocks": NUMBER_OF_RB,
        "subcarriers": SUBCARRIERS,
        "txPowerDbm": TOTAL_TX_POWER_DBM,
        "baseRePowerDbm": BASE_RE_POWER_DBM,
        "rsPowerOffsetDb": RS_POWER_OFFSET_DB,
        "rsrpReferencePowerDbm": RSRP_REFERENCE_POWER_DBM,
        "cableLossDb": CABLE_LOSS_DB,
        "systemLossDb": SYSTEM_LOSS_DB,
        "powerInputMode": "user-provided independent total and Base RE powers",
    }

# ---- 안테나 ----
# 260827_pattern.xlsx / 야기+옴니 시트의
# '수평' = 수평면(Azimuth), '수직' = 수직면(Elevation) 방사 패턴
#
# 현재는 2개의 2D cut으로 3D 패턴을 근사한다.
# 추후 드론 실측 데이터가 생기면 별도의 3D correction을 이 패턴 위에 적용한다.
ANTENNA_PATTERN_RES_DEG = 0.25

# 패턴의 방위각 기준 방향을 실제 설치 방향에 맞추고 싶을 때 사용.
# 이중 야기 방향을 실제 설치 방위에 맞출 때 사용한다.
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
    """계산에 사용하는 사용자 지정 십진 좌표."""
    return BS_LAT, BS_LON
