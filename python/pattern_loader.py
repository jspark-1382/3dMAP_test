# ============================================================
# OM900 측정 안테나 패턴 CSV 파서
#   - Data/pattern/OM900_pattern_1.csv 전용
#   - 도표 각도 deg: 0=천정(zenith), ±90=수평, 180=저중
#     → Sionna 극각(theta, 천정 기준)과 동일 스케일이므로 그대로 매핑
#   - 열 구성: [deg, 910MHz 수평, 910MHz 수직, 955MHz 수평, 955MHz 수직]
#     · 수직 열 = 주편파(co-pol, 수직편파 옴니)
#     · 수평 열 = 교차편파(cross-pol)
# ============================================================
import codecs
import csv
import os

DEFAULT_PATTERN_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "..", "Data", "pattern", "OM900_pattern_1.csv",
)

FREQ_BANDS = {
    "910": {"h_col": 1, "v_col": 2},   # 헤더 이후 데이터 행의 열 인덱스
    "955": {"h_col": 3, "v_col": 4},
}


def _read_rows(path):
    """cp949(한글 성적서) 우선 → utf-8 폴백으로 모든 행 읽기."""
    for enc in ("cp949", "utf-8-sig", "utf-8"):
        try:
            with codecs.open(path, "r", enc) as f:
                return list(csv.reader(f))
        except UnicodeDecodeError:
            continue
    raise IOError("패턴 CSV 인코딩을 판별할 수 없습니다: %s" % path)


def load_pattern(path=None, freq="910"):
    """측정 안테나 패턴 로드.

    반환 dict:
      model       : 안테나 모델명 (예: 'PM-OM900_06')
      freq_mhz    : 선택된 주파수(MHz)
      theta_deg   : 극각 목록(deg, 0=천정) — 오름차순 정렬됨
      gain_v_dbi  : 수직(주)편파 절대 이득(dBi)
      gain_h_dbi  : 수평(교차)편파 절대 이득(dBi)
      max_gain_dbi: 주편파 최대 이득(dBi)
    """
    if path is None:
        path = DEFAULT_PATTERN_PATH
    if str(freq) not in FREQ_BANDS:
        raise ValueError("지원하지 않는 주파수 대역: %s (가능: %s)" % (freq, ", ".join(FREQ_BANDS)))
    cols = FREQ_BANDS[str(freq)]

    rows = _read_rows(os.path.abspath(path))
    model = ""
    entries = {}  # theta_deg -> [gain_h, gain_v]
    for i, row in enumerate(rows):
        if i == 0:
            model = (row[1] if len(row) > 1 else "").strip()
            continue
        if i < 3:
            continue  # 주파수/열제목 헤더 스킵
        if not row or not row[0].strip():
            continue
        try:
            deg = float(row[0])
            g_h = float(row[cols["h_col"]])
            g_v = float(row[cols["v_col"]])
        except (ValueError, IndexError):
            continue  # 숫자 아닌 행 무시
        entries[deg] = [g_h, g_v]

    if not entries:
        raise ValueError("유효한 패턴 데이터 행이 없습니다: %s" % path)

    theta = sorted(entries.keys())
    # 각도는 -180~179 (혹은 -180~180): 천정 기준 극각으로 그대로 사용
    # 중복 각도(-180 vs 180)가 있으면 평균 처리되어 entries에서 자동 병합됨
    return {
        "model": model,
        "freq_mhz": int(str(freq)),
        "theta_deg": theta,
        "gain_v_dbi": [entries[t][1] for t in theta],
        "gain_h_dbi": [entries[t][0] for t in theta],
        "max_gain_dbi": max(entries[t][1] for t in theta),
    }


def gain_at(pattern, theta_deg, pol="v"):
    """극각 theta_deg(천정 기준)에서 선형보간 이득(dBi)."""
    theta = pattern["theta_deg"]
    gains = pattern["gain_v_dbi" if pol == "v" else "gain_h_dbi"]
    n = len(theta)
    t = max(theta[0], min(theta[-1], float(theta_deg)))
    lo, hi = 0, n - 1
    while hi - lo > 1:
        mid = (lo + hi) // 2
        if theta[mid] <= t:
            lo = mid
        else:
            hi = mid
    if theta[hi] == theta[lo]:
        return gains[lo]
    f = (t - theta[lo]) / (theta[hi] - theta[lo])
    return gains[lo] + f * (gains[hi] - gains[lo])


if __name__ == "__main__":
    p = load_pattern(freq="910")
    print("모델:", p["model"], "/ 주파수:", p["freq_mhz"], "MHz")
    print("각도 수:", len(p["theta_deg"]),
          "/ 범위:", p["theta_deg"][0], "~", p["theta_deg"][-1], "deg")
    print("주편파(V-pol) 최대 이득: %.2f dBi" % p["max_gain_dbi"])
    print("수평(θ=90°) 이득: %.2f dBi" % gain_at(p, 90))
    print("천정(θ=0°) 이득: %.2f dBi" % gain_at(p, 0))
