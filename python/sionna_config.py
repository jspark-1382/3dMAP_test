# ============================================================
# Sionna RT 커버리지 시뮬레이션 설정
#   - run_coverage.py 가 읽어 사용하는 유일한 설정 파일
# ============================================================

# ---- 기지국 위치: 34°36'45.7"N 127°12'21.5"E ----
BS_LAT_DMS = (34, 36, 45.7)
BS_LON_DMS = (127, 12, 21.5)
BS_ALT_M = 16.0          # 안테나 설치 고도(m, 지표 기준) — 필요시 수정

# ---- 주파수 / 전력 ----
FREQ_BAND = "910"        # 패턴 CSV 대역: "910" 또는 "955"
FREQ_HZ = 910e6
TX_POWER_DBM = 21.0      # 송신 출력(dBm) — 안테나 이득은 패턴에서 별도 반영

# ---- 시뮬레이션 격자 ----
GRID_SIZE_M = 8000.0     # 커버리지 평면 한 변 길이(m) — 기지국 중심
CELL_SIZE_M = 20.0       # 커버리지 셀 해상도(m)
TERMINAL_ALTS_M = [100, 200, 300, 400, 500,1000,2000]   # 단말 고도 구간(m)

# ---- 레이트레이싱 ----
MAX_DEPTH = 5            # 반사/산란 최대 차수 (CPU 속도와 직결)
NUM_SAMPLES = 1_000_000  # 커버리지 맵 샘플 수
LOS_ONLY = False         # True로 줄이면 가시선(LoS)만 계산해 빠른 검증 가능

# ---- 커버리지 판정 ----
COVERAGE_THRESHOLD_DBM = -100.0   # 기존 코드 ALT_COVERAGE_THRESHOLD 와 동일


def bs_lat_lon():
    """DMS → 십진수 도."""
    lat = BS_LAT_DMS[0] + BS_LAT_DMS[1] / 60.0 + BS_LAT_DMS[2] / 3600.0
    lon = BS_LON_DMS[0] + BS_LON_DMS[1] / 60.0 + BS_LON_DMS[2] / 3600.0
    return lat, lon
