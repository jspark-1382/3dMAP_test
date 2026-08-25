// ============================================================
// VWORLD 3D Map 설정 (WebGL 3D지도 API 3.0, Cesium 기반) - 템플릿
// ------------------------------------------------------------
// 사용방법: 이 파일을 config.js로 복사한 후 API 키를 입력하세요.
// ============================================================
var VWORLD_API_KEY = "YOUR_VWORLD_3D_API_KEY";

// 브라우저에서 사용 시 요청URL에 domain 정보를 추가해야 합니다.
// 비워두면 window.location.host (접속 주소) 가 자동 사용됩니다.
var VWORLD_DOMAIN = "";

// 초기 시점 (경도, 위도, 고도) - 대한민국 개괄 보기
var DEFAULT_VIEW = {
    longitude: 127.5,
    latitude: 36.0,
    altitude: 300000
};

// 기본 기지국 (송신원) - 34°36'45.7"N 127°12'21.5"E, 안테나 설치고도 16m
// python/sionna_config.py 의 BS_LAT_DMS/BS_LON_DMS/BS_ALT_M 과 동일 값
var DEFAULT_BS = {
    longitude: 127.2059722,   // 127°12'21.5"E
    latitude: 34.6126944,     // 34°36'45.7"N
    altitude: 16.0            // m
};
