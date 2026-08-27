var assert = require("assert");
var FRIIS = require("../js/friisisosurface.js");

var north = FRIIS.compassPoint(100, 90, 0, 16);
var east = FRIIS.compassPoint(100, 90, 90, 16);
assert.ok(Math.abs(north[0]) < 1e-9);
assert.ok(Math.abs(north[1] - 100) < 1e-9);
assert.ok(Math.abs(east[0] - 100) < 1e-9);
assert.ok(Math.abs(east[1]) < 1e-9);

assert.ok(Math.abs(FRIIS.thresholdScale(-100, -80) - 0.1) < 1e-12);
var distance100 = FRIIS.boundaryDistanceM(0, -100, 21, 910);
var distance80 = FRIIS.boundaryDistanceM(0, -80, 21, 910);
assert.ok(Math.abs(distance80 / distance100 - 0.1) < 1e-12);

console.log("PASS: Friis 가변 RSRP 거리 비율과 북0도/동90도 방위축");
