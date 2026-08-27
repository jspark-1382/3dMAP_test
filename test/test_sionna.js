// ============================================================
// test_sionna.js: js/sionna.js 순수 계산 함수 assert 기반 테스트
//   실행: node test/test_sionna.js  (실패 시 exit 1)
// ============================================================
"use strict";

var path = require("path");
global.RF_COLOR = require(path.join(__dirname, "..", "js", "rfcolor.js"));
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
    near(SIONNA.dbmToT(-90), 0.5, 1e-9);   // 중앙값 (-120~-60 기준)
    near(SIONNA.dbmToT(-200), 0, 1e-9);    // 약한 신호 하한 클램프
    near(SIONNA.dbmToT(0), 1, 1e-9);       // 강한 신호 상한 클램프
});

// ---------- colorForDbm (공통 연속 RSRP 팔레트) ----------
test("colorForDbm: 공통 연속 색상", function () {
    assert(SIONNA.colorForDbm(-60) === "rgb(239,27,23)", "-60dBm은 빨강");
    assert(SIONNA.colorForDbm(-80) === "rgb(255,212,0)", "-80dBm은 노랑");
    assert(SIONNA.colorForDbm(-100) === "rgb(0,168,90)", "-100dBm은 초록");
    assert(SIONNA.colorForDbm(-110) === "rgb(63,55,165)", "-110dBm은 남색");
    assert(SIONNA.colorForDbm(-120) === "rgb(32,32,32)", "-120dBm은 검정");
});

// ---------- dbmToRgb01 ----------
test("dbmToRgb01: bin 색상의 0..1 RGB 변환", function () {
    var r = SIONNA.dbmToRgb01(-60);
    near(r[0], 239 / 255, 1e-6); near(r[1], 27 / 255, 1e-6); near(r[2], 23 / 255, 1e-6);
    assert(r[0] > r[1] && r[0] > r[2], "강한 신호는 빨강 성분이 우세해야 함");
    var g = SIONNA.dbmToRgb01(-100);
    near(g[0], 0, 1e-6); near(g[1], 168 / 255, 1e-6); near(g[2], 90 / 255, 1e-6);
    assert(g[1] > g[0] && g[1] > g[2], "-100dBm은 초록 성분이 우세해야 함");
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

test("compareDatasets: 공통 고도 평균 차이 계산", function () {
    var reflected = {
        meta: { altitudesM: [100, 200] },
        grids: {
            "100": { points: [[34, 127, -70], [34, 127.1, -80]], stats: { meanDbm: -75, coveragePct: 90 } },
            "200": { points: [[34, 127, -79]], stats: { meanDbm: -79, coveragePct: 70 } }
        }
    };
    var freeSpace = {
        meta: { altitudesM: [100, 200] },
        grids: {
            "100": { points: [[34, 127, -72], [34, 127.1, -77]], stats: { meanDbm: -74.5, coveragePct: 85 } },
            "200": { points: [[34, 127, -78]], stats: { meanDbm: -78, coveragePct: 75 } }
        }
    };
    var rows = SIONNA.compareDatasets(reflected, freeSpace);
    assert(rows.length === 2, "두 공통 고도");
    near(rows[0].meanDeltaDb, -0.5, 1e-9);
    near(rows[0].medianDeltaDb, -0.5, 1e-9);  // 셀 차이 -2, +3의 중앙값
    near(rows[0].minDeltaDb, -3, 1e-9);
    near(rows[0].maxDeltaDb, 2, 1e-9);
    near(rows[0].groundStrongerPct, 50, 1e-9);
    near(rows[0].freeStrongerPct, 50, 1e-9);
    near(rows[1].meanDeltaDb, -1, 1e-9);
});

console.log("");
if (failures > 0) {
    console.error(failures + "/" + count + " 테스트 실패");
    process.exit(1);
} else {
    console.log(count + "개 테스트 모두 통과");
}
