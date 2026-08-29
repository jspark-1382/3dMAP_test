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
var distance = comparison.nearestPointAtAltitude(triangles, 100, 0).horizontalDistanceM;
assert.ok(Math.abs(distance - Math.sqrt(20000)) < 1e-9, "distance=" + distance);
console.log("PASS: 삼각형과 고도면 교차점의 최단 수평거리");

var nearest = comparison.nearestPointAtAltitude(triangles, 100, 0);
assert.ok(Math.abs(nearest.eastM - 100) < 1e-9, "east=" + nearest.eastM);
assert.ok(Math.abs(nearest.northM - 100) < 1e-9, "north=" + nearest.northM);
assert.strictEqual(nearest.altitudeM, 100);
console.log("PASS: 수평 도달거리 선 끝점의 ENU 좌표");

var segmentNearest = comparison.nearestPointAtAltitude([
    [-100, 100, 100, 100, 100, 100, 0, 300, 200]
], 100, 0);
assert.ok(Math.abs(segmentNearest.eastM) < 1e-9, "segment east=" + segmentNearest.eastM);
assert.ok(Math.abs(segmentNearest.northM - 100) < 1e-9, "segment north=" + segmentNearest.northM);
assert.ok(Math.abs(segmentNearest.horizontalDistanceM - 100) < 1e-9);
console.log("PASS: 교차선분 내부의 실제 최단점 계산");

var filteredNearest = comparison.nearestPointAtAltitude([
    [100, -20, 100, 100, 20, 100, 120, 0, 100],
    [500, -20, 100, 500, 20, 100, 520, 0, 100]
], 100);
assert.ok(Math.abs(filteredNearest.horizontalDistanceM - 500) < 1e-9);
assert.strictEqual(comparison.minimumHorizontalDistanceM, 200);
console.log("PASS: 기지국 중심 수평거리 200m 이하 교차점 제외");

var farthest = comparison.farthestPointAtAltitude([
    [100, -20, 100, 100, 20, 100, 120, 0, 100],
    [500, -20, 100, 500, 20, 100, 520, 0, 100]
], 100);
assert.ok(Math.abs(farthest.horizontalDistanceM - 520) < 1e-9);
console.log("PASS: 동일 고도 단면의 최장 수평반경 계산");

var spatial = comparison.minimumDistanceAtAltitude({
    meta: {antennaHeightM: 0},
    trianglesEnuM: [[
        300, 0, 0, 500, 0, 200, 300, 200, 200
    ]]
}, 100);
assert.ok(Math.abs(spatial - Math.sqrt(100000)) < 1e-9, "horizontal=" + spatial);
console.log("PASS: 선택 고도에서 경계점까지의 최단 수평 도달거리");

var spatialPoint = comparison.minimumPointAtAltitude({
    meta: {antennaHeightM: 0},
    trianglesEnuM: [[
        300, 0, 0, 500, 0, 200, 300, 200, 200
    ]]
}, 100);
assert.ok(Math.abs(spatialPoint.distanceM - spatial) < 1e-9);
assert.ok(Math.abs(spatialPoint.slantDistanceM - Math.sqrt(110000)) < 1e-9);
assert.ok(spatialPoint.slantDistanceM > spatialPoint.horizontalDistanceM);
console.log("PASS: 표·지도는 수평거리 사용, 대각선 거리는 별도 구분");

assert.strictEqual(comparison.formatDistance(520), "520m");
assert.strictEqual(comparison.formatDistance(1520), "1.5km");
assert.strictEqual(comparison.formatDistance(null), "—");
assert.strictEqual(comparison.formatRange(506, 22698), "506m~22.7km");
console.log("PASS: 거리 단위 표시");

var sliceSegments = comparison.intersectionSegmentsAtAltitude([[
    0, 0, 0,
    200, 0, 200,
    0, 200, 200
]], 100);
assert.strictEqual(sliceSegments.length, 1);
assert.strictEqual(sliceSegments[0][0].altitudeM, 100);
assert.strictEqual(sliceSegments[0][1].altitudeM, 100);
assert.ok(Math.abs(sliceSegments[0][0].eastM - 100) < 1e-9);
assert.ok(Math.abs(sliceSegments[0][1].northM - 100) < 1e-9);
console.log("PASS: 선택 고도와 3D 경계면의 실제 단면 선분 추출");
