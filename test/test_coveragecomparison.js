var assert = require("assert");
var comparison = require("../js/coveragecomparison.js");

assert.deepStrictEqual(
    comparison.altitudeLevels(40000),
    [100, 200, 300, 400, 500, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000, 20000, 30000, 40000]
);
console.log("PASS: 고도 구간 100m/1km/10km 규칙");

var triangles = [
    [100, 0, 0, 300, 0, 200, 100, 200, 200],
    [300, 0, 200, 300, 200, 200, 100, 200, 200]
];
var distance = comparison.minHorizontalDistanceAtAltitude(triangles, 100);
assert.ok(Math.abs(distance - Math.sqrt(20000)) < 1e-9, "distance=" + distance);
console.log("PASS: 삼각형과 고도면 교차점의 최단 수평거리");

var spatial = comparison.minimumDistanceAtAltitude({
    meta: {antennaHeightM: 0},
    trianglesEnuM: triangles
}, 100);
assert.ok(Math.abs(spatial - Math.sqrt(30000)) < 1e-9, "spatial=" + spatial);
console.log("PASS: 기지국 안테나부터 경계점까지의 최단 3D 거리");

assert.strictEqual(comparison.formatDistance(520), "520m");
assert.strictEqual(comparison.formatDistance(1520), "1.5km");
assert.strictEqual(comparison.formatDistance(null), "—");
console.log("PASS: 거리 단위 표시");
