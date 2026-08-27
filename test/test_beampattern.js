// ============================================================
// BEAMPATTERN 모듈 Node 검증
// 실행: node test/test_beampattern.js
// ============================================================
var assert = require("assert");
var BP = require("../js/beampattern.js");

var passed = 0, failed = 0;
function test(name, fn) {
    try { fn(); console.log("PASS - " + name); passed++; }
    catch (e) { console.error("FAIL - " + name + " : " + e.message); failed++; }
}

// ---------- gainAtElevation ----------
test("gainAtElevation: el=0(수평) → 0 dB", function () {
    assert.strictEqual(BP.gainAtElevation(0), 0.0);
});
test("gainAtElevation: el=+90(천정) → -30 dB", function () {
    assert.strictEqual(BP.gainAtElevation(90), -30.0);
});
test("gainAtElevation: el=-90(저중) → -30 dB", function () {
    var g = BP.gainAtElevation(-90);
    // 도표 각도 t = (90-(-90))%360 = 180 → -30.0
    assert.strictEqual(g, -30.0);
});
test("gainAtElevation: el=+30 → 도표 t=60 → -9.0 dB", function () {
    assert.strictEqual(BP.gainAtElevation(30), -9.0);
});
test("gainAtElevation: el=-40 → 도표 t=130 → -16.5 dB", function () {
    assert.strictEqual(BP.gainAtElevation(-40), -16.5);
});
test("gainAtElevation: 보간 el=+35 → t=55 → (-7.5-9)/2=-8.25", function () {
    assert.ok(Math.abs(BP.gainAtElevation(35) - (-8.25)) < 1e-9);
});
test("gainAtElevation: 래핑 el=+100 → t=(90-100)%360=350 → -29.0", function () {
    assert.strictEqual(BP.gainAtElevation(100), -29.0);
});

// ---------- enuToEcef ----------
test("enuToEcef: 원점 오프셋 0 → 좌표 동일", function () {
    var o1 = BP.enuToEcef(127.0, 37.0, 10, 0, 0, 0);
    var o2 = BP.enuToEcef(127.0, 37.0, 10, 0, 0, 0);
    assert.strictEqual(o1.x, o2.x);
    assert.strictEqual(o1.y, o2.y);
    assert.strictEqual(o1.z, o2.z);
});
test("enuToEcef: Up 오프셋 ≒ 방사선 방향 거리 증가", function () {
    var base = BP.enuToEcef(127.20884, 34.61566, 50, 0, 0, 0);
    var up100 = BP.enuToEcef(127.20884, 34.61566, 50, 0, 0, 100);
    var d = Math.sqrt(
        Math.pow(up100.x - base.x, 2) +
        Math.pow(up100.y - base.y, 2) +
        Math.pow(up100.z - base.z, 2)
    );
    assert.ok(Math.abs(d - 100) < 0.5, "거리=" + d);
});
test("enuToEcef: East/North/Up 직교성 (내적≈0)", function () {
    var lon = 127.0, lat = 36.5, h = 30;
    var o = BP.enuToEcef(lon, lat, h, 0, 0, 0);
    var eV = BP.enuToEcef(lon, lat, h, 100, 0, 0);
    var nV = BP.enuToEcef(lon, lat, h, 0, 100, 0);
    var uV = BP.enuToEcef(lon, lat, h, 0, 0, 100);
    var sub = function (a, b) { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; };
    var dot = function (a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; };
    var E = sub(eV, o), N = sub(nV, o), U = sub(uV, o);
    assert.ok(Math.abs(dot(E, N)) < 1e-3, "E·N=" + dot(E, N));
    assert.ok(Math.abs(dot(N, U)) < 1e-3, "N·U=" + dot(N, U));
    assert.ok(Math.abs(dot(U, E)) < 1e-3, "U·E=" + dot(U, E));
    var len = function (v) { return Math.sqrt(dot(v, v)); };
    assert.ok(Math.abs(len(E) - 100) < 0.05, "|E|=" + len(E));
    assert.ok(Math.abs(len(N) - 100) < 0.05, "|N|=" + len(N));
    assert.ok(Math.abs(len(U) - 100) < 0.05, "|U|=" + len(U));
});

// ---------- solveOLS3 ----------
test("solveOLS3: 노이즈 없는 합성데이터 계수 복원", function () {
    var x1 = [], x2 = [], y = [];
    for (var i = 0; i < 20; i++) {
        var a = i * 0.7 + 1, b = (i % 5) * 0.4;
        x1.push(a); x2.push(b);
        y.push(3.5 - 1.25 * a + 0.8 * b);
    }
    var sol = BP.solveOLS3(x1, x2, y);
    assert.ok(sol !== null);
    assert.ok(Math.abs(sol.c0 - 3.5) < 1e-6, "c0=" + sol.c0);
    assert.ok(Math.abs(sol.c1 - (-1.25)) < 1e-6, "c1=" + sol.c1);
    assert.ok(Math.abs(sol.c2 - 0.8) < 1e-6, "c2=" + sol.c2);
});
test("solveOLS3: 특이행렬(null) 처리", function () {
    var sol = BP.solveOLS3([1, 2, 3], [2, 4, 6], [1, 2, 3]); // x2 = 2*x1 → 특이
    assert.strictEqual(sol, null);
});
test("solveOLS3: 데이터 부족 시 null", function () {
    assert.strictEqual(BP.solveOLS3([1], [1], [1]), null);
});

// ---------- solveOLS2 ----------
test("solveOLS2: 기존 calibrateModel과 동일 결과", function () {
    var x1 = [1, 2, 3, 4], ys = [10, 8, 6, 4];
    var sol = BP.solveOLS2(x1, ys);
    assert.ok(Math.abs(sol.c1 - (-2)) < 1e-9);
    assert.ok(Math.abs(sol.c0 - 12) < 1e-9);
});

// ---------- jetColor / buildPatternMesh ----------
test("jetColor: 양끝값 확인", function () {
    var lo = BP.jetColor(0), hi = BP.jetColor(1);
    assert.ok(lo.b > 200 && lo.r < 10, "t=0 파랑: " + JSON.stringify(lo));
    assert.ok(hi.r > 200 && hi.b < 10, "t=1 빨강: " + JSON.stringify(hi));
});
test("buildPatternMesh: 정점 수/인덱스 범위", function () {
    var mesh = BP.buildPatternMesh(500, 15, 5);
    var nAz = 24, nEl = 37; // -90..90 step5
    assert.strictEqual(mesh.positions.length, nAz * nEl);
    assert.strictEqual(mesh.indices.length % 3, 0);
    for (var i = 0; i < mesh.indices.length; i++) {
        assert.ok(mesh.indices[i] >= 0 && mesh.indices[i] < mesh.positions.length);
    }
});
test("buildPatternMesh: 수평 반경 = scale, 천정 반경 ≈ 0", function () {
    var mesh = BP.buildPatternMesh(500, 15, 5);
    var idxH = 12 * 37 + 18;   // az=180, el=0 (els 인덱스 18)
    var idxTop = 12 * 37 + 36; // az=180, el=90
    var ph = mesh.positions[idxH];
    var pt = mesh.positions[idxTop];
    var rh = Math.sqrt(ph.e * ph.e + ph.n * ph.n);
    var rt = Math.sqrt(pt.e * pt.e + pt.n * pt.n + pt.u * pt.u);
    assert.ok(Math.abs(rh - 500) < 0.01, "rh=" + rh);
    assert.ok(rt < 500 * 0.04, "rt=" + rt + " (10^(-30/20)=0.0316)");
    assert.strictEqual(ph.gainDb, 0.0);
    assert.strictEqual(pt.gainDb, -30.0);
});

// ---------- 틸트/스윙 ----------
test("tiltedGain: 틸트 0이면 gainAtElevation과 동일", function () {
    assert.strictEqual(BP.tiltedGain(30, 45, 0, 0), BP.gainAtElevation(30));
    assert.strictEqual(BP.tiltedGain(-40, 200, 0, 123), BP.gainAtElevation(-40));
});
test("tiltedGain: 틸트 10°·스윙 0° → 북쪽(az=0) 수평방향은 안테나 el'=−10 → G(−10)=-12.5", function () {
    // sin(el') = cos(0)sin(10)cos(0) + 0 = sin(10) → el' = −10
    // t = 90+10 = 100 → -8.5? 표: 100 → -8.5. 확인: gainAtElevation(-10): t=100 → -8.5
    assert.strictEqual(BP.tiltedGain(0, 0, 10, 0), BP.gainAtElevation(-10));
});
test("tiltedGain: 틸트 10°·스윙 0° → 남쪽(az=180) 수평방향은 el'=+10 → G(10)=-29.0", function () {
    assert.strictEqual(BP.tiltedGain(0, 180, 10, 0), BP.gainAtElevation(10));
});
test("tiltedGain: 틸트 방향 아래 10° 지점은 주엽 통과 → G(0)=0 dB", function () {
    // az=0(스윙 방향), el=−10, 틸트 10 → el'=0 → 0 dB
    assert.strictEqual(BP.tiltedGain(-10, 0, 10, 0), 0.0);
});
test("tiltedGain: 스윙 90°면 동쪽(az=90)이 틸트 방향", function () {
    assert.strictEqual(BP.tiltedGain(-10, 90, 10, 90), 0.0);
    assert.strictEqual(BP.tiltedGain(0, 90, 10, 90), BP.gainAtElevation(-10));
});
test("rotateENU: 천정 벡터가 틸트만큼 스윙 방향으로 기울어짐", function () {
    var r = BP.rotateENU(0, 0, 1, 10, 90);
    var t = 10 * Math.PI / 180;
    assert.ok(Math.abs(r.e - Math.sin(t)) < 1e-9, "e=" + r.e);
    assert.ok(Math.abs(r.n) < 1e-9, "n=" + r.n);
    assert.ok(Math.abs(r.u - Math.cos(t)) < 1e-9, "u=" + r.u);
});
test("rotateENU: 길이 불변", function () {
    var r = BP.rotateENU(300, 400, 50, 7.5, 215);
    var len = Math.sqrt(r.e * r.e + r.n * r.n + r.u * r.u);
    assert.ok(Math.abs(len - Math.sqrt(300 * 300 + 400 * 400 + 50 * 50)) < 1e-6);
});
test("bearingDeg: 북동남서", function () {
    assert.ok(Math.abs(BP.bearingDeg(127, 34, 127, 34.01)) < 0.01, "북=" + BP.bearingDeg(127, 34, 127, 34.01));
    assert.ok(Math.abs(BP.bearingDeg(127, 34, 127.01, 34) - 90) < 0.5, "동=" + BP.bearingDeg(127, 34, 127.01, 34));
    assert.ok(Math.abs(BP.bearingDeg(127, 34, 127, 33.99) - 180) < 0.01);
    assert.ok(Math.abs(BP.bearingDeg(127, 34, 126.99, 34) - 270) < 0.5);
});
test("buildPatternMesh: 틸트 적용 시 천정 정점이 기울어짐", function () {
    var mesh = BP.buildPatternMesh(500, 15, 5, 10, 90);
    var idxTop = 6 * 37 + 36; // az=90, el=90
    var pt = mesh.positions[idxTop];
    // az=90 방향(동)으로 틸트 10° → e = 15.8·sin10° ≈ 2.74, u = 15.8·cos10° ≈ 15.56
    var t = 10 * Math.PI / 180;
    assert.ok(Math.abs(pt.e - 500 * 0.0316 * Math.sin(t)) < 0.1, "e=" + pt.e);
    assert.ok(Math.abs(pt.u - 500 * 0.0316 * Math.cos(t)) < 0.1, "u=" + pt.u);
});

// ---------- buildPatternMeshFromGain ----------
test("buildPatternMeshFromGain: 방위 무관 함수 → buildPatternMesh와 동일 결과", function () {
    var m1 = BP.buildPatternMesh(500, 15, 5);
    var m2 = BP.buildPatternMeshFromGain(function (_az, el) { return BP.gainAtElevation(el); }, 500, 15, 5);
    assert.strictEqual(m2.positions.length, m1.positions.length);
    for (var i = 0; i < m1.positions.length; i++) {
        var a = m1.positions[i], b = m2.positions[i];
        if (Math.abs(a.e - b.e) > 1e-9 || Math.abs(a.n - b.n) > 1e-9 ||
            Math.abs(a.u - b.u) > 1e-9 || a.gainDb !== b.gainDb) {
            throw new Error("정점 " + i + " 불일치");
        }
    }
});
test("buildPatternMeshFromGain: 방위 의존 함수가 반경에 반영됨", function () {
    // 동쪽(az=90)만 0dB, 나머지 -20dB 인 방위 의존 패턴
    function g(az) { return (Math.abs(az - 90) < 1e-9) ? 0 : -20; }
    var mesh = BP.buildPatternMeshFromGain(function (az, _el) { return g(az); }, 500, 15, 5);
    var idxEastH = 6 * 37 + 18;    // az=90, el=0
    var idxWestH = 18 * 37 + 18;   // az=270, el=0
    var pe = mesh.positions[idxEastH];
    var pw = mesh.positions[idxWestH];
    var re = Math.sqrt(pe.e * pe.e + pe.n * pe.n + pe.u * pe.u);
    var rw = Math.sqrt(pw.e * pw.e + pw.n * pw.n + pw.u * pw.u);
    assert.ok(Math.abs(re - 500) < 0.01, "동쪽 반경=" + re);
    assert.ok(Math.abs(rw - 500 * Math.pow(10, -1)) < 0.5, "서쪽 반경=" + rw);
    assert.strictEqual(pe.gainDb, 0);
    assert.strictEqual(pw.gainDb, -20);
});

// ---------- beamColor / BEAM_BINS (RSRP 색상 구분 옵션) ----------
test("beamColor: 양끝값 (t=0 남색, t=1 핑크)", function () {
    var lo = BP.beamColor(0), hi = BP.beamColor(1);
    assert.ok(lo.b > 200 && lo.r < 100, "t=0 남색: " + JSON.stringify(lo));
    assert.ok(hi.r > 200 && hi.g > 80 && hi.b > 150, "t=1 핑크: " + JSON.stringify(hi));
});
test("beamColor: 범위 클램프 및 단조성", function () {
    assert.deepStrictEqual(BP.beamColor(-5), BP.beamColor(0));
    assert.deepStrictEqual(BP.beamColor(5), BP.beamColor(1));
    var prev = BP.beamColor(0);
    for (var t = 0.1; t <= 1.001; t += 0.1) {
        var c = BP.beamColor(t);
        assert.ok(c.r >= prev.r, "r 단조 증가 t=" + t);
        prev = c;
    }
});
test("BEAM_BINS: 5dB 단위 7개 bin, 0dB~−30dB 이하 전체 커버", function () {
    assert.strictEqual(BP.BEAM_BINS.length, 7);
    assert.strictEqual(BP.BEAM_BINS[0].hi, 0);
    assert.strictEqual(BP.BEAM_BINS[BP.BEAM_BINS.length - 1].lo, -Infinity);
    for (var i = 0; i < BP.BEAM_BINS.length - 1; i++) {
        assert.strictEqual(BP.BEAM_BINS[i].lo, BP.BEAM_BINS[i + 1].hi, "bin 경계 연속성 i=" + i);
        assert.ok(/^#[0-9a-f]{6}$/i.test(BP.BEAM_BINS[i].color), "색상 형식 i=" + i);
    }
});
test("BEAM_BINS: 대표 이득값이 올바른 bin에 매핑됨", function () {
    function binFor(g) {
        for (var i = 0; i < BP.BEAM_BINS.length; i++) {
            var b = BP.BEAM_BINS[i];
            if (g <= b.hi && g > b.lo) return b;
        }
        return BP.BEAM_BINS[BP.BEAM_BINS.length - 1];
    }
    assert.strictEqual(binFor(0).color, "#f472b6");      // 최대 강
    assert.strictEqual(binFor(-7.5).color, "#e879f9");
    assert.strictEqual(binFor(-30).color, "#4f46e5");    // 최약
    assert.strictEqual(binFor(-60).color, "#4f46e5");    // RT 결측 클램프 영역
});

console.log("\n" + passed + " passed, " + failed + " failed");
if (failed > 0) process.exit(1);
