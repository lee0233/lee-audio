/* PC-1 system-load simulation. This module does not read an AC power meter.
 * PC-1 feeds DP-1, CC-1, and PA-1 and consumes some power itself. The B&W
 * 702 S3 Signature speakers are passive: their power comes from PA-1, not a
 * separate wall outlet. We assume the speakers use the MC152's 4-ohm taps.
 *
 * Audio-level calibration uses a DX5 balanced-output voltage as a PROXY for
 * the amp input. The actual RS130 -> C53 DAC/volume -> MC152 gain path has not
 * been measured or calibrated. Thus the numbers are plausible estimates, not
 * specifications for this exact rack at a given volume setting.
 */
(function (root) {
    // Nominal US mains voltage; this simulation does not model line sag.
    const LINE_VOLTS = 120;
    // MC152-rated output per channel on its 2-, 4-, or 8-ohm output taps.
    const RATED_WATTS_PER_CHANNEL = 150;
    // Proxy: digital full-scale sine RMS -> 4.2 Vrms balanced output.
    const DX5_FULL_SCALE_BALANCED_VOLTS = 4.2;
    // Proxy: amp input voltage that corresponds to rated output.
    const MC152_RATED_INPUT_VOLTS = 2.4;
    // Active wall-power budgets in watts. They form a 160 W system baseline:
    // 95 + 20 + 30 + 15. Some references inform these choices, but these are
    // NOT measurements of the pictured rack. In particular, PA-1 idle draw and
    // PC-1 overhead are provisional simulation assumptions.
    const ACTIVE_WATTS = Object.freeze({
        powerAmp: 95,
        digitalPlayer: 20,
        controlCenter: 30,
        powerCenter: 15
    });
    // The three fixed-load devices each contribute apparent power (VA) equal
    // to their assumed real power (W) divided by their assumed power factor.
    // These PF values are provisional, not readings from those devices.
    const OTHER_APPARENT_VA = ACTIVE_WATTS.digitalPlayer / 0.92 +
        ACTIVE_WATTS.controlCenter / 0.90 + ACTIVE_WATTS.powerCenter / 0.95;
    // For extra PA-1 speaker output, assume 0.68 W reaches the speaker for
    // each additional 1 W taken from the wall. This is an incremental model,
    // separate from the amplifier's 95 W active baseline.
    const INCREMENTAL_EFFICIENCY = 0.68;
    // PA-1's assumed PF rises with output, from idle to rated stereo output.
    const IDLE_POWER_FACTOR = 0.72;
    const LOADED_POWER_FACTOR = 0.90;
    // A full-scale digital sine wave has RMS amplitude 1/sqrt(2).
    const FULL_SCALE_SINE_RMS = Math.SQRT1_2;

    function clamp(value, min, max) {
        return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : min;
    }

    function channelOutputWatts(rms) {
        // Convert one channel's measured digital RMS into proxy amp-input Vrms:
        // V_in = clamp(rms, 0, 1) / (1/sqrt(2)) * 4.2 V.
        // A full-scale sine maps to 4.2 V; this is a calibration assumption,
        // not a measurement of the actual C53 output voltage.
        const inputVolts = clamp(rms, 0, 1) / FULL_SCALE_SINE_RMS * DX5_FULL_SCALE_BALANCED_VOLTS;
        // Power follows voltage squared until the rated 150 W/channel cap:
        // P_channel = 150 * min(1, (V_in / 2.4 V)^2).
        // Speaker impedance dips do not directly multiply the MC152's rated
        // output, and turning volume to 100% does not force 150 W continuously.
        return RATED_WATTS_PER_CHANNEL * Math.min(1, (inputVolts / MC152_RATED_INPUT_VOLTS) ** 2);
    }

    class SystemLoadEstimator {
        constructor() { this.reset(); }

        reset() {
            this.outputWatts = 0;
            this.updatedAt = null;
        }

        update(metrics, nowMs) {
            // Sum left/right estimated speaker output. Use RMS, not peak
            // samples: a brief transient should not become sustained wall draw.
            const target = channelOutputWatts(metrics.leftRms) + channelOutputWatts(metrics.rightRms);
            if (this.updatedAt === null || !Number.isFinite(nowMs) || nowMs - this.updatedAt > 1000) {
                // Initialize immediately and discard stale history after a gap.
                this.outputWatts = target;
            } else {
                const elapsed = clamp(nowMs - this.updatedAt, 0, 1000);
                // Fast attack, slower decay: tau is in milliseconds. This
                // gives a steadier mains estimate than the live VU needles.
                const timeConstant = target > this.outputWatts ? 180 : 750;
                // First-order smoothing: P += (target - P) * (1 - e^(-dt/tau)).
                this.outputWatts += (target - this.outputWatts) * (1 - Math.exp(-elapsed / timeConstant));
            }
            this.updatedAt = nowMs;

            // PA-1 wall W = 95 W active baseline + speaker-output W / 0.68.
            // The three other devices add fixed active loads. The speakers
            // themselves add no separate mains draw to this sum.
            const ampWatts = ACTIVE_WATTS.powerAmp + this.outputWatts / INCREMENTAL_EFFICIENCY;
            const wallWatts = ampWatts + ACTIVE_WATTS.digitalPlayer +
                ACTIVE_WATTS.controlCenter + ACTIVE_WATTS.powerCenter;
            // Blend PA-1 PF from 0.72 at idle to 0.90 at 300 W stereo output.
            // The square root is a chosen curve, not measured MC152 behavior.
            const loadRatio = this.outputWatts / (2 * RATED_WATTS_PER_CHANNEL);
            const ampPowerFactor = IDLE_POWER_FACTOR +
                (LOADED_POWER_FACTOR - IDLE_POWER_FACTOR) * Math.sqrt(loadRatio);
            // Raw system apparent power: add each device's W/PF in VA.
            // Then system PF = total real W / total apparent VA.
            const apparentVA = ampWatts / ampPowerFactor + OTHER_APPARENT_VA;
            // PC-1 shows PF with two decimals, so use that same rounded value
            // for the subsequent current/VA/W readouts.
            const powerFactor = Math.round(wallWatts / apparentVA * 100) / 100;

            // Display order deliberately starts with current:
            // A  = round_0.01(P_wall / (120 V * displayed PF))
            // VA = round_1(120 V * displayed A)
            // W  = round_1(displayed VA * displayed PF)
            // Consequently the visible 120 V, A, VA, W, and PF agree to their
            // printed precision. Displayed W can differ slightly from the raw
            // wallWatts estimate because every readout is rounded.
            const amps = Math.round(wallWatts / (LINE_VOLTS * powerFactor) * 100) / 100;
            const va = Math.round(LINE_VOLTS * amps);
            const watts = Math.round(va * powerFactor);
            return { volts: LINE_VOLTS, amps, va, watts, powerFactor };
        }
    }

    const api = { SystemLoadEstimator, channelOutputWatts, ACTIVE_WATTS };
    if (typeof module !== "undefined" && module.exports) module.exports = api;
    else root.LeeAudioPowerModel = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
