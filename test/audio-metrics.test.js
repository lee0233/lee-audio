const { test } = require('node:test');
const assert = require('node:assert/strict');
const { AudioMetricsHub, SimulatorProvider, normalizeMetrics } = require('../lib/audio-metrics');

test('invalid samples cannot produce non-finite display values', () => {
    const frame = normalizeMetrics({ leftPeak: Infinity, rightPeak: -1, leftRms: NaN, spectrumBands: [2, NaN, -1] });
    assert.equal(frame.leftPeak, 0);
    assert.equal(frame.rightPeak, 0);
    assert.equal(frame.leftRms, 0);
    assert.equal(frame.spectrumBands.length, 24);
    assert.deepEqual(frame.spectrumBands.slice(0, 3), [1, 0, 0]);
});

test('hub starts once, unsubscribes and can restart', () => {
    const provider = new SimulatorProvider();
    const hub = new AudioMetricsHub(provider);
    let frames = 0;
    hub.on('metrics', data => { frames++; assert.equal(data.source, 'simulator'); });
    try {
        hub.start(); hub.start(); provider.tick();
        assert.equal(frames, 1);
        hub.stop(); provider.tick(); assert.equal(frames, 1);
        hub.start(); provider.tick(); assert.equal(frames, 2);
    } finally { hub.stop(); }
});

test('native frame preserves physical amplitude and capture format', () => {
    const frame = normalizeMetrics({ leftPeak: 0.5, rightRms: 0.35355, sampleRate: 192000, channels: 2, source: 'coreaudio' });
    assert.equal(frame.leftPeak, 0.5);
    assert.equal(frame.rightRms, 0.35355);
    assert.equal(frame.sampleRate, 192000);
    assert.equal(frame.source, 'coreaudio');
});
