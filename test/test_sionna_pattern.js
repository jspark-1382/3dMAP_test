// ============================================================
// SIONNA RT 예측 기반 빔패턴 추출 검증
// 실행: node test/test_sionna_pattern.js
// ============================================================
var fs = require("fs");
var path = require("path");
var assert = require("assert");

var SIONNA = require("../js/sionna.js");

var passed = 0, failed = 0;
function test(name, fn) {
    try { fn(); console.log("PASS - " + name); passed++; }
    catch (e) { console.error("FAIL - " + name + " : " + e.message); failed++; }
}

// ---------- 합성 데이터: 동쪽이 강한 비대칭 커버리지 ----------
function syntheticData() {
    var bsLat = 34.5, bsLon = 127.2;
    var grids = {};
    var pts = [];
    var mPerDegLon = 111320 * Math.cos(bsLat * Math.PI / 180);
    for (var az = 0; az < 360; az += 5) {
        for (var r = 100; r <= 3000; r += 100) {
            var e = r * Math.sin(az * Math.PI / 180);
            var n = r * Math.cos(az * Math.PI / 180);
            // 동쪽(az=90) -50dBm, 서쪽(az=270) -90dBm 선형 보간 + 거리 감쇠
            var azFactor = (Math.sin(az * Math.PI / 180) + 1) / 2;   // 동=1, 서=0
            var dbm = -90 + azFactor * 40 - 10 * Math.log10(r / 100);
            pts.push([bsLat + n / 111320, bsLon + e / mPerDegLon, Math.round(dbm * 10) / 10]);
        }
    }
    grids["100"] = {
        points: pts,
        stats: { count: pts.length, meanDbm: -70, minDbm: -95, maxDbm: -45, coveragePct: 50 }
    };
    return {
        meta: {
            bs: { lat: bsLat, lon: bsLon },
            antennaHeightM: 16,
            altitudesM: [100],
            frequencyMHz: 910,
            coverageThresholdDbm: -100
        },
        grids: grids
    };
}

test("extractPattern: 합성 데이터에서 방위별 비대칭 반영", function () {
    var d = syntheticData();
    var pat = SIONNA.extractPattern(d, null);
    assert.ok(pat !== null, "패턴 추출 실패");
    assert.strictEqual(pat.azStep, 5);
    assert.strictEqual(pat.nAz, 72);
    assert.strictEqual(pat.nEl, 37);
    assert.ok(pat.sampleCount > 0, "샘플 수=" + pat.sampleCount);

    var fn = SIONNA.makeGainFn(pat);
    assert.ok(fn !== null);

    // 정규화: 최대 이득은 0dB
    var maxG = -Infinity;
    for (var ia = 0; ia < pat.nAz; ia++) {
        for (var ie = 0; ie < pat.nEl; ie++) {
            var v = pat.gain[ia][ie];
            assert.ok(isFinite(v), "결측 빈 존재: [" + ia + "][" + ie + "]=" + v);
            if (v > maxG) maxG = v;
        }
    }
    assert.ok(Math.abs(maxG) < 1e-9, "최대 이득=" + maxG);

    // 동쪽 수평방향이 서쪽보다 확실히 강함 (합성 차이 40dB → 여유 두고 검증)
    var gE = fn(90, 0), gW = fn(270, 0);
    assert.ok(gE - gW > 20, "동-서 차이=" + (gE - gW).toFixed(1));
});

test("makeGainFn: 방위각 래핑 — gain(az) == gain(az±360)", function () {
    var pat = SIONNA.extractPattern(syntheticData(), null);
    var fn = SIONNA.makeGainFn(pat);
    for (var az = 0; az < 360; az += 30) {
        for (var el = -60; el <= 60; el += 20) {
            assert.ok(Math.abs(fn(az, el) - fn(az + 360, el)) < 1e-9, "az=" + az);
            assert.ok(Math.abs(fn(az, el) - fn(az - 360, el)) < 1e-9, "az=" + az);
        }
    }
});

test("extractPattern: 잘못된 입력 → null", function () {
    assert.strictEqual(SIONNA.extractPattern(null, null), null);
    assert.strictEqual(SIONNA.extractPattern({}, null), null);
    assert.strictEqual(SIONNA.extractPattern(syntheticData(), [999]), null);
});

test("extractPattern: 특정 고도만 선택", function () {
    var d = syntheticData();
    d.grids["200"] = d.grids["100"];
    d.meta.altitudesM = [100, 200];
    var patAll = SIONNA.extractPattern(d, null);
    var pat100 = SIONNA.extractPattern(d, [100]);
    assert.strictEqual(patAll.altitudes.length, 2);
    assert.deepStrictEqual(pat100.altitudes, [100]);
    assert.strictEqual(pat100.sampleCount * 2, patAll.sampleCount);
});

// ---------- 실제 RT 결과 파일 검증 (있으면) ----------
test("실제 sionna_coverage.json 기반 패턴 추출", function () {
    var jsonPath = path.join(__dirname, "..", "Data", "sionna", "sionna_coverage.json");
    if (!fs.existsSync(jsonPath)) {
        console.log("  SKIP - Data/sionna/sionna_coverage.json 없음");
        return;
    }
    var real = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    var pat = SIONNA.extractPattern(real, null);
    assert.ok(pat !== null, "패턴 추출 실패");
    var fn = SIONNA.makeGainFn(pat);
    assert.ok(fn !== null);

    var nFinite = 0, maxG = -Infinity;
    for (var ia = 0; ia < pat.nAz; ia++) {
        for (var ie = 0; ie < pat.nEl; ie++) {
            var v = pat.gain[ia][ie];
            assert.ok(isFinite(v));
            nFinite++;
            if (v > maxG) maxG = v;
        }
    }
    assert.strictEqual(nFinite, pat.nAz * pat.nEl);
    assert.ok(Math.abs(maxG) < 1e-9, "최대=" + maxG);
    // 전 방위 조회 시 NaN 없음
    for (var az = 0; az <= 360; az += 5) {
        for (var el = -90; el <= 90; el += 5) {
            assert.ok(isFinite(fn(az, el)), "조회 실패 az=" + az + " el=" + el);
        }
    }
    console.log("  실제 데이터: 샘플 " + pat.sampleCount + "점 · 고도 [" +
                pat.altitudes.join("/") + "] · 원본 " +
                pat.sourceMinDbm + "~" + pat.sourceMaxDbm + "dBm");
});

console.log("\n" + passed + " passed, " + failed + " failed");
if (failed > 0) process.exit(1);