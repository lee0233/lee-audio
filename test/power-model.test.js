const { test } = require('node:test');
const assert = require('node:assert/strict');
const { SystemLoadEstimator, channelOutputWatts, ACTIVE_WATTS } = require('../public/power-model');

function close(actual, expected, tolerance = 1) {
    assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} should be within ${tolerance} of ${expected}`);
}

test('silence retains the whole rack’s operating draw; sample peaks alone do not become wall watts', () => {
    assert.equal(ACTIVE_WATTS.digitalPlayer, 20);
    assert.equal(ACTIVE_WATTS.controlCenter, 30);
    const estimator = new SystemLoadEstimator();
    const quiet = estimator.update({ leftRms: 0, rightRms: 0, leftPeak: 1, rightPeak: 1 }, 0);
    assert.equal(quiet.watts, Object.values(ACTIVE_WATTS).reduce((sum, watts) => sum + watts, 0));
    assert.equal(quiet.powerFactor, 0.79);
    assert.ok(quiet.amps > 0);
    assert.deepEqual(quiet, estimator.update({ leftRms: 0, rightRms: 0, leftPeak: 0, rightPeak: 0 }, 50));
});

test('rated stereo output yields a heavier but bounded simulated mains load', () => {
    const estimator = new SystemLoadEstimator();
    const fullScaleSine = { leftRms: Math.SQRT1_2, rightRms: Math.SQRT1_2 };
    const load = estimator.update(fullScaleSine, 0);
    assert.equal(channelOutputWatts(Math.SQRT1_2), 150);
    assert.equal(channelOutputWatts(10), 150);
    assert.ok(load.watts > 590 && load.watts < 650);
    assert.ok(load.powerFactor > 0.85 && load.powerFactor < 0.95);
    close(load.va, load.volts * load.amps, 0.5);
    close(load.watts, load.va * load.powerFactor, 0.5);
});

test('both RMS channels affect the load, with a quick rise and slower return to idle', () => {
    const mono = new SystemLoadEstimator().update({ leftRms: 0.2, rightRms: 0 }, 0);
    const stereo = new SystemLoadEstimator().update({ leftRms: 0.2, rightRms: 0.2 }, 0);
    assert.ok(stereo.watts > mono.watts);
    assert.ok(stereo.watts > 150);

    const estimator = new SystemLoadEstimator();
    estimator.update({ leftRms: 0, rightRms: 0 }, 0);
    const attack = estimator.update({ leftRms: 0.3, rightRms: 0.3 }, 180);
    const release = estimator.update({ leftRms: 0, rightRms: 0 }, 360);
    assert.ok(attack.watts > 160);
    assert.ok(release.watts > 160 && release.watts < attack.watts);
    assert.equal(estimator.update({ leftRms: 0, rightRms: 0 }, 4000).watts, 160);
});
