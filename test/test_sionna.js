// ============================================================
// test_sionna.js: js/sionna.js 순수 계산 함수 assert 기반 테스트
//   실행: node test/test_sionna.js  (실패 시 exit 1)
// ============================================================
"use strict";

var path = require("path");
var SIONNA = require(path.join(__dirname, "..", "js", "sionna.js"));

var failures = 0;
var count = 0;

function test(name, fn) {
    count++;
    try {
        fn();
        console.log("PASS: " + name);
    } catch (e) {
        failures++;
        console.error("FAIL: " + name + " -> " + e.message);
    }
}

function assert(cond, msg) { if (!cond) throw new Error(msg || "assertion failed"); }
function near(a, b, eps) {
    if (Math.abs(a - b) > (eps || 1e-6)) {
        throw new Error(a + " != " + b + " (eps " + eps + ")");
    }
}

// ---------- dbmToT ----------
test("dbmToT: 범위 클램프", function () {
    near(SIONNA.dbmToT(-70), 0.5, 1e-9);   // 중앙값 (-40~-100 기준)
    near(SIONNA.dbmToT(-200), 1, 1e-9);    // 약한 신호 하한 클램프
    near(SIONNA.dbmToT(0), 0, 1e-9);       // 강한 신호 상한 클램프
});

// ---------- colorForDbm (10dB 이산 bin, 기존 RF 범례 팔레트) ----------
test("colorForDbm: 10dB 단위 이산 색상 (초록=강함 → 빨강=약함)", function () {
    assert(SIONNA.colorForDbm(-45).indexOf("hsl(120,") === 0, "-45dBm은 밝은 초록: " + SIONNA.colorForDbm(-45));
    assert(SIONNA.colorForDbm(-45).indexOf("62%)") > 0, "-45dBm은 최강(명도 62%): " + SIONNA.colorForDbm(-45));
    assert(SIONNA.colorForDbm(-60).indexOf("hsl(120,78%,50%)") === 0, "-60dBm은 초록: " + SIONNA.colorForDbm(-60));
    assert(SIONNA.colorForDbm(-70).indexOf("hsl(90,78%,50%)") === 0, "-70dBm은 연두: " + SIONNA.colorForDbm(-70));
    assert(SIONNA.colorForDbm(-80).indexOf("hsl(60,78%,50%)") === 0, "-80dBm은 노랑: " + SIONNA.colorForDbm(-80));
    assert(SIONNA.colorForDbm(-90).indexOf("hsl(30,78%,50%)") === 0, "-90dBm은 주황: " + SIONNA.colorForDbm(-90));
    assert(SIONNA.colorForDbm(-100).indexOf("hsl(0,78%,50%)") === 0, "-100dBm은 빨강: " + SIONNA.colorForDbm(-100));
    assert(SIONNA.colorForDbm(-30).indexOf("hsl(120,") === 0, "-30dBm(범위 밖 강함)도 초록 클램프");
    assert(SIONNA.colorForDbm(-150).indexOf("hsl(0,") === 0, "-150dBm(범위 밖 약함)도 빨강 클램프");
});

// ---------- dbmToRgb01 ----------
test("dbmToRgb01: bin 색상의 0..1 RGB 변환", function () {
    var g = SIONNA.dbmToRgb01(-60);   // hsl(120,78%,50%) 초록 ≈ (0.11, 0.89, 0.11)
    near(g[1], 0.89, 1e-3); near(g[0], 0.11, 1e-3); near(g[2], 0.11, 1e-3);
    assert(g[1] > g[0] && g[1] > g[2], "초록 성분이 우세해야 함");
    var r = SIONNA.dbmToRgb01(-100);  // hsl(0,78%,50%) 빨강 ≈ (0.89, 0.11, 0.11)
    near(r[0], 0.89, 1e-3); near(r[1], 0.11, 1e-3); near(r[2], 0.11, 1e-3);
    assert(r[0] > r[1] && r[0] > r[2], "빨강 성분이 우세해야 함");
});

// ---------- computeStats ----------
test("computeStats: 평균/최소/커버리지", function () {
    var pts = [
        [34.0, 127.0, -60],
        [34.0, 127.001, -90],
        [34.0, 127.002, -110],
        [34.0, 127.003, -95]
    ];
    var s = SIONNA.computeStats(pts, -100);
    assert(s.count === 4, "count");
    near(s.meanDbm, (-60 - 90 - 110 - 95) / 4, 1e-9);
    near(s.minDbm, -110, 1e-9);
    near(s.maxDbm, -60, 1e-9);
    near(s.coveragePct, 75, 1e-9);   // -60, -90, -95 가 -100 이상
});

test("computeStats: 빈 배열 안전 처리", function () {
    var s = SIONNA.computeStats([], -100);
    assert(s.count === 0 && s.coveragePct === 0, "빈 배열");
});

// ---------- filterCorridor ----------
test("filterCorridor: 방위각 방향 코리도 필터링", function () {
    var bsLat = 34.6127, bsLon = 127.2060;
    var mLat = 1 / 111320;                       // 1m 위도
    var mLon = 1 / (111320 * Math.cos(bsLat * Math.PI / 180));  // 1m 경도
    // [동쪽오프셋m, 북쪽오프셋m] 기준 점들
    function pt(eastM, northM) {
        return [bsLat + northM * mLat, bsLon + eastM * mLon, -70];
    }
    var pts = [
        pt(0, 500),      // 북쪽 500m
        pt(30, 500),     // 북쪽 500m + 동쪽 30m (폭 내)
        pt(200, 500),    // 북쪽 500m + 동쪽 200m (폭 밖)
        pt(0, -500),     // 남쪽 500m (북쪽 방향의 뒤쪽)
        pt(500, 0)       // 동쪽 500m
    ];
    // 북쪽(0°), 반폭 50m → 앞의 2개만
    var north = SIONNA.filterCorridor(pts, bsLat, bsLon, 0, 50, 0);
    assert(north.length === 2, "북쪽 코리도는 2개 점: " + north.length);
    // 남쪽(180°) → 뒤쪽 점 1개
    var south = SIONNA.filterCorridor(pts, bsLat, bsLon, 180, 50, 0);
    assert(south.length === 1, "남쪽 코리도는 1개 점: " + south.length);
    // 동쪽(90°) → 동쪽 점 1개
    var east = SIONNA.filterCorridor(pts, bsLat, bsLon, 90, 50, 0);
    assert(east.length === 1, "동쪽 코리도는 1개 점: " + east.length);
    // 거리 제한: 북쪽 300m 이내 → 500m 점들은 제외 → 0개
    var limited = SIONNA.filterCorridor(pts, bsLat, bsLon, 0, 50, 300);
    assert(limited.length === 0, "거리 제한 시 0개: " + limited.length);
});

test("enuOffsetM: ENU 오프셋 계산", function () {
    var en = SIONNA.enuOffsetM(34.6127, 127.2060, 34.6127 + 100 / 111320,
                               127.2060);
    near(en[0], 0, 1e-6);        // 경도 동일 → 동쪽 0m
    near(en[1], 100, 0.5);       // 북쪽 약 100m
});

// ---------- summarize ----------
test("summarize: meta.altitudesM 순서대로 요약", function () {
    var fake = {
        meta: { altitudesM: [100, 200, 300], coverageThresholdDbm: -100 },
        grids: {
            "100": { points: [], stats: { count: 4, meanDbm: -70, minDbm: -110, maxDbm: -50, coveragePct: 75 } },
            "200": { points: [], stats: { count: 4, meanDbm: -80, minDbm: -105, maxDbm: -55, coveragePct: 50 } }
            // 300 누락 → 건너뜀
        }
    };
    var rows = SIONNA.summarize(fake);
    assert(rows.length === 2, "누락된 고도 제외");
    assert(rows[0].alt === 100 && rows[1].alt === 200, "순서 유지");
    near(rows[0].stats.meanDbm, -70, 1e-9);
});

console.log("");
if (failures > 0) {
    console.error(failures + "/" + count + " 테스트 실패");
    process.exit(1);
} else {
    console.log(count + "개 테스트 모두 통과");
}
