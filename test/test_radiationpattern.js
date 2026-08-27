// ============================================================
// 측정 H/V 안테나 고유 방사 패턴 계산 검증
// 실행: node test/test_radiationpattern.js
// ============================================================
"use strict";

var fs = require("fs");
var path = require("path");
var assert = require("assert");
var BP = require("../js/beampattern.js");

var json = JSON.parse(fs.readFileSync(
    path.join(__dirname, "..", "Data", "sionna", "antenna_pattern.json"),
    "utf8"
));

assert(BP.setThetaPattern(json.thetaDeg, json.verticalRelativeGainDb));
assert(BP.setHorizontalPattern(json.phiDeg, json.horizontalRelativeGainDb));

function near(actual, expected, tolerance, label) {
    assert(Math.abs(actual - expected) <= tolerance,
        label + ": " + actual + " != " + expected);
    console.log("PASS: " + label);
}

// 합성 이득은 V-Plane 상대이득 + H-Plane 상대이득이다.
near(
    BP.gainAtDirection(0, 0),
    BP.gainAtElevation(0) + BP.horizontalGainAtAzimuth(0),
    1e-9,
    "H/V separable 이득 합성"
);

near(
    BP.horizontalGainAtAzimuth(181),
    BP.horizontalGainAtAzimuth(-179),
    1e-9,
    "H-Plane 방위각 360도 래핑"
);

var gains = [];
for (var az = 0; az < 360; az += 5) gains.push(BP.horizontalGainAtAzimuth(az));
var spread = Math.max.apply(null, gains) - Math.min.apply(null, gains);
assert(spread > 5 && spread < 8, "측정 H-Plane 편차가 약 6.8dB여야 함: " + spread);
console.log("PASS: 측정 H-Plane 방향 편차 " + spread.toFixed(1) + "dB");

var mesh = BP.buildPatternMeshFromGain(BP.gainAtDirection, 300, 15, 5, 0, 0);
assert(mesh.positions.length === 24 * 37, "3D 메시 정점 수");
assert(mesh.indices.length > 0, "3D 메시 면 생성");
console.log("PASS: 측정 H/V 3D 메시 생성");

var meta = BP.getPatternMeta();
assert(meta.model && meta.frequencyMHz === 910, "패턴 메타데이터");
console.log("PASS: 패턴 메타데이터");
