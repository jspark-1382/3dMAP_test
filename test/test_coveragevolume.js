// Sionna 3D 수신 가능 볼륨의 순수 격자 판정 검증
var assert = require("assert");
var VOLUME = require("../js/coveragevolume.js");

assert.strictEqual(VOLUME.gridSizeFor(new Array(22500)), 150);
assert.strictEqual(VOLUME.gridSizeFor(new Array(10)), 0);

var insideOnly = [
    -110, -110, -110,
    -110,  -90, -110,
    -110, -110, -110
];
var boundaryCovered = [
     -90, -110, -110,
    -110, -110, -110,
    -110, -110, -110
];
assert.strictEqual(VOLUME.touchesBoundary(insideOnly, 3, -100), false);
assert.strictEqual(VOLUME.touchesBoundary(boundaryCovered, 3, -100), true);

console.log("PASS: 정사각 Sionna 격자 크기 판정");
console.log("PASS: RSRP 임계영역의 계산 경계 도달 판정");
