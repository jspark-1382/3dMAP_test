var assert = require("assert");
var RP = require("../js/radiationpattern.js");

assert.strictEqual(RP.radiusFactor(0, "db", -40), 1);
assert.strictEqual(RP.radiusFactor(-40, "db", -40), 0.05);
assert.ok(Math.abs(RP.radiusFactor(-20, "amplitude", -40) - 0.1) < 1e-12);
assert.ok(Math.abs(RP.radiusFactor(-20, "power", -40) - 0.01) < 1e-12);

assert.strictEqual(RP.linearInterp([0, 10], [0, -10], 5), -5);
assert.strictEqual(RP.linearInterp([0, 10], [0, -10], -2), 0);
assert.strictEqual(RP.linearInterp([0, 10], [0, -10], 20), -10);

var pattern = {
    key: "test",
    thetaDeg: [0, 90, 180],
    vertical3dRelativeGainDb: [-20, 0, -20],
    phiDeg: [-180, 0, 180],
    horizontal3dRelativeGainDb: [-10, 0, -10]
};
assert.strictEqual(RP.directionGain(pattern, 0, 0), 0);
assert.strictEqual(RP.directionGain(pattern, 180, 0), -10);
assert.strictEqual(RP.directionGain(pattern, 0, 90), -20);

var idealOmni = RP.idealOmniPattern();
assert.strictEqual(RP.directionGain(idealOmni, 0, 0), 0);
assert.strictEqual(RP.directionGain(idealOmni, 90, 0), 0);
assert.strictEqual(RP.directionGain(idealOmni, 180, 0), 0);
assert.ok(RP.directionGain(idealOmni, 0, 90) <= -100);
assert.ok(RP.directionGain(idealOmni, 0, -90) <= -100);

console.log("PASS: 방사 패턴 반경, H/V 합성, 이상적 옴니 기준 계산");
