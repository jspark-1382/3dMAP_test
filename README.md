# 브이월드 3D 지도 - CSV 좌표 이동

VWORLD WebGL 3D지도 API 3.0 (Cesium 기반)을 사용해 3D 지도를 띄우고,
CSV 파일을 업로드하면 해당 좌표로 카메라를 이동시키는 간단한 웹 앱입니다.

## 준비 (필수)

1. **VWORLD API 키 발급**
   - https://dev.vworld.kr 에서 회원가입 후 "3D 지도" API 키를 발급받으세요.
2. `js/config.js` 파일에서 `VWORLD_API_KEY` 값에 발급받은 키를 입력하세요.
   ```js
   var VWORLD_API_KEY = "1234-5678-9ABC-DEF0-1234";
   ```
   키 없이는 지형/영상이 로드되지 않습니다(화면에 경고 표시).

## 실행 방법

파일을 브라우저로 직접 열면 CORS/로컬 파일 제한 문제가 있을 수 있으므로
**로컬 정적 서버**로 실행하세요. 예: 프로젝트 폴더에서

```bash
# Python
python -m http.server 8000
```
```bash
# 또는 Node (npx 사용 가능한 경우)
npx http-server -p 8000
```

브라우저에서 `http://localhost:8000` 접속 → 지도가 뜨면 CSV 업로드.

## CSV 형식

헤더의 컬럼명에서 키워드(`latitude`, `longitude`, `altitude`)를 자동으로 찾습니다.
`sample/drone_data.csv` 예시 참고:

```
Idx, CID_1, Time, [LTE][L1][RF]PCI, [LTE][L1][RF]RSRP (dBm)(dBm), [General][GPS]Latitude, [General][GPS]Longitude, [General][Drone Telemetry]App Pressure Altitude(m)
1, ,11:19:25,171,-73.4,34.61566,127.2088419,-67.21
...
```

- 구분자: 쉼표 / 탭 / 세미콜론 자동 감지
- 좌표계: EPSG:4326(경위도, WGS84)

## 기능

- [x] VWORLD 3D 지도(브이월드 지형/영상) 표시
- [x] CSV 업로드(파일 선택 또는 지도에 드래그앤드롭)
- [x] 첫 데이터 행의 고도값을 빼 **0점(첫 행) 기준**으로 고도 보정 (음수면 더해져 0점, 양수면 빼져 0점)
- [x] 각 좌표로 카메라 이동(`camera.flyTo`) + 마커 표시
- [x] 좌표 목록 클릭 이동 / 첫·이전·다음·마지막·홈 버튼
- [x] 원본/보정 고도, 시간, RSRP 부가정보 표시
- [x] 안테나 고유 방사 패턴 — 측정 H-Plane/V-Plane을 합성한 상대이득 3D 형상
- [x] Sionna 고도면 적층 보기 — 고도별 실제 계산 셀 중 설정한 RSRP 기준 이상만
  색상점·임계 경계·고도 연결선으로 독립 표시(기본 -100dBm)
- [x] Sionna -100dBm 연속 3D 경계면 — 별도 320km×320km·고도 40km Sionna
  계산에서 수평/상단 경계 안에 닫힌 등가면 메시 추출
- [x] 기존 3D 방향성 표시 — 레거시 V-Plane 형상 또는 선택한 커버리지 결과를
  방위각×고도각 5° 빈으로 변환한 분석용 형상(안테나 고유 패턴과 구분)

## 파일 구조

```
index.html            # UI
css/style.css         # 스타일
js/config.js          # VWORLD API 키/서버 설정
js/csv.js             # CSV 파서
js/rfcolor.js         # CSV·일반 예측·Sionna 공통 RSRP 색상/범례
js/radiationpattern.js # 측정 H/V 안테나 고유 방사 패턴 표시
js/coveragevolume.js  # Sionna RSRP 임계값 기반 3D 수신 가능 볼륨
js/coverageisosurface.js # 별도 Sionna 계산의 -100dBm 연속 3D 등가면
js/main.js            # VWORLD 3D(webglMapInit) + 지도 + CSV 연동
sample/drone_data.csv # 테스트용 CSV
test/test_csv.js      # CSV 파서 Node 검증
test/test_coveragevolume.js # 3D 볼륨 격자/경계 판정 검증
js/sionna.js          # Sionna RT 커버리지 표시 모듈
python/run_coverage.py # Sionna RT 예측 실행 스크립트 (python/ 폴더 참고)
python/run_coverage_volume_3d.py # 넓은 3D 격자 계산과 임계 등가면 추출
python/export_antenna_pattern.py # 브라우저용 측정 H/V 패턴 JSON 생성
```

## Sionna RT 커버리지 예측 (선택)

측정 안테나 패턴(`Data/pattern/OM900_pattern_1.csv`, 910MHz)을 적용해
기지국(34°36'45.7"N 127°12'21.5"E) 주변의 수신 전력을 레이트레이싱으로 예측하고,
단말 고도 100~2000m 구간별 커버리지를 지도 위에 표시합니다. 동일한 Sionna RT 설정에서
지면 정반사만 끈 자유공간 직접파 결과도 함께 생성해 동일 셀의 절대 RSRP를 비교할 수 있습니다.
Sionna가 필요 없는 Friis 수식 결과(`python/formula_pathloss.py`)도 별도로 제공합니다.

```bash
# 최초 1회: Python 3.11 가상환경에 Sionna 설치 (시스템 기본 python 버전과 무관)
py -3.11 -m venv .venv-sionna
.venv-sionna\Scripts\pip install sionna

# 시뮬레이션 실행 (--quick: 저해상도 빠른 검증)
.venv-sionna\Scripts\python python\run_coverage.py

# 자유공간 비교 결과만 다시 생성
.venv-sionna\Scripts\python python\run_coverage.py --free-space-only

# Sionna 없이 Friis 수식 Pathloss 결과만 생성
python python\formula_pathloss.py

# 서버 실행 후 "전파 환경"을 선택하거나 [두 환경 수치 비교] 클릭
python -m http.server 8000
```

- 기지국 좌표·안테나 고도·TX 전력·격자 해상도 등은 `python/sionna_config.py`에서 수정
- 평탄 지면 결과는 `Data/sionna/sionna_coverage.json`, 자유공간 결과는
  `Data/sionna/sionna_free_space.json`, 수식 결과는 `Data/sionna/formula_pathloss.json`으로
  저장되며 `js/sionna.js`가 로드

## 주의

- 엔진 CDN은 `js/config.js`의 `VWORLD_ENGINE_BASE`에 있습니다.
  기본값은 `https://cdn.xdworld.kr/beta/` (XDWorld 배포 CDN) 입니다.
  만약 지도가 뜨지 않으면 VWORLD 3D 오픈 API 가이드의 최신 엔진 주소로 바꿔주세요.

