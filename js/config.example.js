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
