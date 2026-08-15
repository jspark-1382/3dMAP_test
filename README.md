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

## 파일 구조

```
index.html            # UI
css/style.css         # 스타일
js/config.js          # VWORLD API 키/서버 설정
js/csv.js             # CSV 파서
js/main.js            # VWORLD 3D(webglMapInit) + 지도 + CSV 연동
sample/drone_data.csv # 테스트용 CSV
test/test_csv.js      # CSV 파서 Node 검증
```

## 주의

- 엔진 CDN은 `js/config.js`의 `VWORLD_ENGINE_BASE`에 있습니다.
  기본값은 `https://cdn.xdworld.kr/beta/` (XDWorld 배포 CDN) 입니다.
  만약 지도가 뜨지 않으면 VWORLD 3D 오픈 API 가이드의 최신 엔진 주소로 바꿔주세요.

