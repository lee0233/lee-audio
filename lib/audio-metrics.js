const { EventEmitter } = require("events");

const BAND_COUNT = 24;

function clamp(value, min = 0, max = 1) {
    return Number.isFinite(Number(value)) ? Math.max(min, Math.min(max, Number(value))) : min;
}

function normalizeMetrics(metrics = {}) {
    const spectrum = Array.from({ length: BAND_COUNT }, (_, index) => clamp(metrics.spectrumBands?.[index]));
    return {
        type: "audio-metrics",
        timestamp: Number(metrics.timestamp) || Date.now(),
        leftPeak: clamp(metrics.leftPeak),
        rightPeak: clamp(metrics.rightPeak),
        leftRms: clamp(metrics.leftRms),
        rightRms: clamp(metrics.rightRms),
        spectrumBands: spectrum,
        sampleRate: Number(metrics.sampleRate) || null,
        channels: Number(metrics.channels) || 2,
        source: metrics.source || "unknown"
    };
}

class AudioMetricsHub extends EventEmitter {
    constructor(provider) {
        super();
        this.provider = provider;
        this.unsubscribe = null;
    }

    start() {
        if (!this.provider || this.unsubscribe) return;
        this.unsubscribe = this.provider.subscribe(metrics => this.emit("metrics", normalizeMetrics(metrics)));
        this.provider.start?.();
    }

    stop() {
        this.unsubscribe?.();
        this.unsubscribe = null;
        this.provider?.stop?.();
    }
}

class SimulatorProvider {
    constructor({ intervalMs = 33, bands = BAND_COUNT } = {}) {
        this.intervalMs = intervalMs;
        this.bands = bands;
        this.listeners = new Set();
        this.timer = null;
        this.phase = 0;
    }

    subscribe(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    start() {
        if (this.timer) return;
        this.timer = setInterval(() => this.tick(), this.intervalMs);
    }

    stop() {
        clearInterval(this.timer);
        this.timer = null;
    }

    tick() {
        this.phase += 0.055;
        const leftPeak = 0.18 + (Math.sin(this.phase * 1.7) + 1) * 0.32 + Math.random() * 0.18;
        const rightPeak = 0.18 + (Math.sin(this.phase * 1.9 + 1.1) + 1) * 0.32 + Math.random() * 0.18;
        const spectrumBands = Array.from({ length: this.bands }, (_, index) =>
            0.12 + Math.max(0, Math.sin(this.phase * 1.4 + index * 0.72)) * 0.52 + Math.random() * 0.2
        );
        const metrics = normalizeMetrics({
            timestamp: Date.now(),
            leftPeak,
            rightPeak,
            leftRms: leftPeak * 0.7,
            rightRms: rightPeak * 0.7,
            spectrumBands,
            source: "simulator"
        });
        for (const listener of this.listeners) listener(metrics);
    }
}

module.exports = { AudioMetricsHub, SimulatorProvider, normalizeMetrics, BAND_COUNT };
