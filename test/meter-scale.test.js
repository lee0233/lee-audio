const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
// Exercise the actual renderer mapping without requiring browser/audio hardware.
const source = fs.readFileSync(require.resolve('../public/app.js'), 'utf8');
const scale = source.slice(source.indexOf('const markings ='), source.indexOf('function point('));
const angle = vm.runInNewContext(`${scale}\namplitudeToNeedleAngle`);
test('digital amplitudes align with printed decibel marks', () => {
    for (const [db, expected] of [[-50,-55],[-40,-37],[-30,-19],[-20,-1],[-10,17],[-3,29.6],[0,35],[3,54]]) {
        assert.ok(Math.abs(angle(10 ** (db / 20)) - expected) < 1e-8, `${db} dB`);
    }
});
test('silence, subscale and overscale readings hit mechanical stops', () => {
    assert.equal(angle(0), -55);
    assert.equal(angle(1e-8), -55);
    assert.equal(angle(2), 54);
});
