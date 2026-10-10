const track = document.getElementById("track");
const artist = document.getElementById("artist");
const album = document.getElementById("album");
const artwork = document.getElementById("artwork");
const elapsed = document.getElementById("elapsed");
const duration = document.getElementById("duration");
const elapsedBottom = document.getElementById("elapsed-bottom");
const durationBottom = document.getElementById("duration-bottom");
const pcAmps = document.getElementById("pc-amps");
const pcVA = document.getElementById("pc-va");
const pcWatts = document.getElementById("pc-watts");
const pcPowerFactor = document.getElementById("pc-pf");
// PC-1's simulated mains estimate is separate from the live VU/spectrum UI.
// All electrical assumptions and rounding live in power-model.js.
const pcLoadEstimator = new LeeAudioPowerModel.SystemLoadEstimator();
const progressFill = document.getElementById("progress-fill");
const progressTrack = document.querySelector(".progress-track");
const formatReadout = document.getElementById("format-readout");
const ccFormatReadout = document.getElementById("cc-format-readout");
const ccChannelReadout = document.getElementById("cc-channel-readout");
const ccVolumeValue = document.getElementById("cc-volume-value");
const ccVolumeUnit = document.getElementById("cc-volume-unit");
const ccVolumeReading = document.querySelector(".volume-reading");
const ccVolumeSegments = document.getElementById("cc-volume-segments");
const ccVolumeKnob = document.getElementById("cc-volume-knob");
const ccMuteButton = document.getElementById("cc-mute-button");
const ccDisplayButton = document.getElementById("cc-display-button");
const ccSignal = document.querySelector(".cc-signal");
const ccSignalLabel = ccSignal.querySelector(".cc-label");
const ccSpectrum = document.getElementById("cc-spectrum");
const ccSpectrumVolume = document.getElementById("cc-spectrum-volume");
const ccSpectrumStatus = document.getElementById("cc-spectrum-status");
const ccSpectrumBars = document.getElementById("cc-spectrum-bars");
const ccStereoFills = [document.getElementById("cc-level-left"), document.getElementById("cc-level-right")];
const ccStereoLevels = [0, 0];
const ccSpectrumBarValues = Array.from({ length: 24 }, () => 0);
const ccSpectrumPeakValues = Array.from({ length: 24 }, () => 0);
const ccSpectrumPeakTimes = Array.from({ length: 24 }, () => 0);

ccSpectrumBarValues.forEach(() => {
    const bar = document.createElement("div");
    bar.className = "spectrum-bar";
    ccSpectrumBars.appendChild(bar);
});
const ccSpectrumBarElements = [...ccSpectrumBars.children];
let spectrumActive = false;
let latestMetrics = null;
let metricsReceivedAt = 0;
let latestPowerLoad = null;
let currentVolume = { type: "number", min: 0, max: 100, value: 0, isMuted: false };
let queuedVolume = null;
let volumeSendTimer = null;

function formatForDisplay(value) {
    const text = value || "FORMAT";
    const match = text.match(/\s*[·•]\s*(\d+)\s*ch\s*$/i);
    if (!match) return { format: text, channels: "" };
    const channels = Number(match[1]) === 2 ? "STEREO" : Number(match[1]) === 1 ? "MONO" : `${match[1]} CH`;
    return { format: text.slice(0, match.index), channels };
}

function renderVolume(volume) {
    currentVolume = {
        type: volume.type || "number",
        min: Number.isFinite(Number(volume.min)) ? Number(volume.min) : 0,
        max: Number.isFinite(Number(volume.max)) ? Number(volume.max) : 100,
        value: Number(volume.value),
        isMuted: Boolean(volume.isMuted)
    };
    const unit = currentVolume.type === "db" ? "dB" : "%";
    const ratio = currentVolume.max > currentVolume.min
        ? Math.max(0, Math.min(1, (currentVolume.value - currentVolume.min) / (currentVolume.max - currentVolume.min)))
        : 0;
    const valueText = Number.isFinite(currentVolume.value)
        ? currentVolume.value.toFixed(unit === "dB" ? 1 : 0)
        : "—";
    ccVolumeValue.textContent = valueText;
    ccVolumeUnit.textContent = unit;
    ccSpectrumVolume.textContent = valueText === "—" ? valueText : `${valueText}${unit}`;
    ccSpectrumVolume.classList.toggle("muted", currentVolume.isMuted);
    ccVolumeSegments.style.setProperty("--volume-level", `${ratio * 100}%`);
    ccVolumeKnob.style.setProperty("--knob-angle", `${-135 + ratio * 270}deg`);
    ccVolumeKnob.dataset.min = currentVolume.min;
    ccVolumeKnob.dataset.max = currentVolume.max;
    ccMuteButton.classList.toggle("active", currentVolume.isMuted);
    ccMuteButton.setAttribute("aria-label", currentVolume.isMuted ? "Unmute" : "Mute");
}

const leftNeedle = document.getElementById("leftNeedle");
const rightNeedle = document.getElementById("rightNeedle");
const previousButton = document.getElementById("previous-button");
const playButton = document.getElementById("play-button");
const nextButton = document.getElementById("next-button");

const NS = "http://www.w3.org/2000/svg";

function setMarquee(element, value) {
    const text = value || "";
    if (element.textContent === text && element.dataset.marqueeMeasured === "true") return;

    element.textContent = text;
    element.classList.remove("is-scrolling");
    element.dataset.marqueeMeasured = "false";

    requestAnimationFrame(() => {
        const windowElement = element.parentElement;
        const distance = windowElement.clientWidth - element.scrollWidth;
        if (distance < -2) {
            element.style.setProperty("--scroll-distance", `${distance}px`);
            element.style.setProperty("--scroll-duration", `${Math.max(8, Math.min(24, 4 + Math.abs(distance) * 0.035))}s`);
            element.classList.add("is-scrolling");
        }
        element.dataset.marqueeMeasured = "true";
    });
}

window.addEventListener("resize", () => {
    [track, artist, album].forEach(element => {
        element.dataset.marqueeMeasured = "false";
        setMarquee(element, element.textContent);
    });
});

/* Decorative power scale: 0 dB = 150 W; P = 150 * 10 ** (dB / 10).
 * Watt labels are decorative. Live needles indicate digital sample-peak dBFS.
 * Keep the original pivot; space the main 10 dB steps evenly.
 */
const markings = [
    { db: -50, angle: -55, watts: "0.0015" },
    { db: -40, angle: -37, watts: "0.015" },
    { db: -30, angle: -19, watts: "0.15" },
    { db: -20, angle: -1, watts: "1.5" },
    { db: -10, angle: 17, watts: "15" },
    { db: -5, angle: 26 },
    { db: -3, angle: 29.6 },
    { db: -1, angle: 33.2 },
    { db: 0, angle: 35, watts: "150" },
    { db: 1, angle: 41.33 },
    { db: 2, angle: 47.67 },
    { db: 3, angle: 54, watts: "300" }
];

// Interpolate through the same marks used to draw the scale, including its
// expanded 0 to +3 dB section. Silence rests at the left stop.
function amplitudeToNeedleAngle(amplitude) {
    const db = amplitude > 0 ? 20 * Math.log10(amplitude) : -Infinity;
    if (db <= markings[0].db) return markings[0].angle;
    for (let i = 1; i < markings.length; i++) {
        const a = markings[i - 1], b = markings[i];
        if (db <= b.db) return a.angle + (b.angle - a.angle) * (db - a.db) / (b.db - a.db);
    }
    return markings[markings.length - 1].angle;
}

function point(angle, radius) {
    const r = angle * Math.PI / 180;

    return {
        x: 500 + Math.sin(r) * radius,
        y: 455 - Math.cos(r) * radius
    };
}

function drawScale(groupId) {

    const group = document.getElementById(groupId);

    const start = point(-55, 330);
    const end = point(54, 330);
    const arc = document.createElementNS(NS, "path");
    arc.setAttribute("d", `M ${start.x} ${start.y} A 330 330 0 0 1 ${end.x} ${end.y}`);
    arc.setAttribute("class", "scale-arc");
    group.appendChild(arc);

    markings.forEach(mark => {
        const major = mark.watts !== undefined;
        const inner = point(mark.angle, major ? 307 : 318);
        const outer = point(mark.angle, 345);
        const tick = document.createElementNS(NS, "line");
        tick.setAttribute("x1", inner.x);
        tick.setAttribute("y1", inner.y);
        tick.setAttribute("x2", outer.x);
        tick.setAttribute("y2", outer.y);
        tick.setAttribute("class", "scale-line");
        group.appendChild(tick);

        if (!major) return;
        for (const [label, radius, unit] of [
            [mark.watts, 379, "watts"],
            [mark.db > 0 ? `+${mark.db}` : String(mark.db), 279, "db"]
        ]) {
            const position = point(mark.angle, radius);
            const number = document.createElementNS(NS, "text");
            number.setAttribute("x", position.x);
            number.setAttribute("y", position.y);
            number.setAttribute("class", `scale-number scale-${unit}`);
            number.textContent = label;
            group.appendChild(number);
        }
    });
}

drawScale("leftScale");
drawScale("rightScale");


// -------------------------------------------------------
// Roon
// -------------------------------------------------------

const socket = new WebSocket(`ws://${location.host}`);

socket.addEventListener("open", () => {
    console.log("Connected to LEE AUDIO");
});

socket.addEventListener("message", event => {

    const data = JSON.parse(event.data);

    if (data.type === "audio-status") {
        ccSpectrum.title = data.message;
        if (data.state !== "live") {
            // A disconnected/stopped audio feed must not leave an old load
            // reading on screen or carry its smoothing history into playback.
            latestMetrics = null;
            metricsReceivedAt = 0;
            latestPowerLoad = null;
            pcLoadEstimator.reset();
        }
        return;
    }
    if (data.type === "audio-metrics") {
        // One stereo RMS sample updates the whole-rack estimate. Peaks still
        // drive the needle presentation, but are not treated as wall watts.
        latestMetrics = data;
        metricsReceivedAt = performance.now();
        latestPowerLoad = pcLoadEstimator.update(data, metricsReceivedAt);
        return;
    }

    if (data.type !== "now-playing") return;

    setMarquee(track, data.track);
    setMarquee(artist, data.artist);
    setMarquee(album, data.album);
    const isPlaying = data.state === "playing";
    playButton.textContent = isPlaying ? "" : "▶";
    playButton.classList.toggle("pause-state", isPlaying);
    playButton.setAttribute("aria-label", data.state === "playing" ? "Pause" : "Play");
    const displayFormat = formatForDisplay(data.format);
    formatReadout.textContent = displayFormat.channels
        ? `${displayFormat.format} · ${displayFormat.channels}`
        : displayFormat.format;
    if (ccFormatReadout) ccFormatReadout.textContent = displayFormat.format;
    if (ccChannelReadout) ccChannelReadout.textContent = displayFormat.channels || "STEREO";

    if (data.volume) renderVolume(data.volume);

    const formatTime = seconds => {
        if (!Number.isFinite(seconds) || seconds <= 0) return "--:--";
        const minutes = Math.floor(seconds / 60);
        const remainder = Math.floor(seconds % 60).toString().padStart(2, "0");
        return `${minutes}:${remainder}`;
    };
    const elapsedText = formatTime(data.seekPosition);
    const durationText = formatTime(data.length);
    elapsed.textContent = elapsedText === "--:--" ? "0:00" : elapsedText;
    duration.textContent = durationText;
    duration.dataset.seconds = data.length > 0 ? String(data.length) : "";
    elapsedBottom.textContent = elapsed.textContent;
    durationBottom.textContent = durationText;
    const progress = data.length > 0
        ? Math.max(0, Math.min(100, (data.seekPosition / data.length) * 100))
        : 0;
    progressFill.style.width = `${progress}%`;

if (data.imageKey) {
    artwork.src =
        `http://192.168.1.20:9330/api/image/${encodeURIComponent(data.imageKey)}?scale=fit&width=600&height=600`;

    artwork.style.display = "block";
} else {
    artwork.removeAttribute("src");
    artwork.style.display = "none";
}

    document.title = data.artist
        ? `${data.track} — ${data.artist}`
        : "LEE AUDIO";
});

function sendControl(control) {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ control }));
}

function sendVolumeFromPointer(event) {
    const bounds = ccVolumeKnob.getBoundingClientRect();
    const x = event.clientX - (bounds.left + bounds.width / 2);
    const y = event.clientY - (bounds.top + bounds.height / 2);
    let angle = Math.atan2(x, -y) * 180 / Math.PI;
    angle = Math.max(-135, Math.min(135, angle));
    const ratio = (angle + 135) / 270;
    const value = currentVolume.min + ratio * (currentVolume.max - currentVolume.min);
    currentVolume.value = value;
    renderVolume(currentVolume);
    queuedVolume = value;
    if (!volumeSendTimer) {
        volumeSendTimer = setTimeout(() => {
            if (socket.readyState === WebSocket.OPEN && queuedVolume !== null) {
                socket.send(JSON.stringify({ control: "volume", value: queuedVolume }));
            }
            queuedVolume = null;
            volumeSendTimer = null;
        }, 32);
    }
}

ccVolumeKnob.addEventListener("pointerdown", event => {
    if (socket.readyState !== WebSocket.OPEN) return;
    ccVolumeKnob.setPointerCapture(event.pointerId);
    sendVolumeFromPointer(event);
});
ccVolumeKnob.addEventListener("pointermove", event => {
    if (ccVolumeKnob.hasPointerCapture(event.pointerId)) sendVolumeFromPointer(event);
});
ccVolumeKnob.addEventListener("pointerup", event => ccVolumeKnob.releasePointerCapture(event.pointerId));
ccMuteButton.addEventListener("click", () => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ control: "mute" }));
});

ccDisplayButton.addEventListener("click", () => {
    spectrumActive = !spectrumActive;
    ccSpectrum.hidden = !spectrumActive;
    ccSignalLabel.textContent = spectrumActive ? "SPECTRUM" : "VOLUME";
    [ccVolumeReading, ccVolumeSegments, ccSignal.querySelector(".signal-details")]
        .forEach(element => element.hidden = spectrumActive);
    ccDisplayButton.classList.toggle("active", spectrumActive);
    ccDisplayButton.setAttribute("aria-pressed", String(spectrumActive));
    ccDisplayButton.setAttribute("aria-label", spectrumActive ? "Show volume display" : "Show spectrum display");
});

progressTrack.addEventListener("click", event => {
    const durationSeconds = Number(duration.dataset.seconds || 0);
    if (!durationSeconds || socket.readyState !== WebSocket.OPEN) return;
    const bounds = progressTrack.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    socket.send(JSON.stringify({ control: "seek", seconds: ratio * durationSeconds }));
});

previousButton.addEventListener("click", () => sendControl("previous"));
playButton.addEventListener("click", () => sendControl("playpause"));
nextButton.addEventListener("click", () => sendControl("next"));

socket.addEventListener("close", () => {
    setMarquee(track, "Connection lost");
    setMarquee(artist, "");
    setMarquee(album, "");
});


// -------------------------------------------------------
// Audio metrics presentation
// -------------------------------------------------------

let leftLevel = -25;
let rightLevel = -23;
let lastMeterFrameAt = 0;

// Time-based motion keeps the meters equally responsive on 60/120 Hz screens.
function approach(current, target, elapsedMs, riseMs, fallMs) {
    const timeConstant = target > current ? riseMs : fallMs;
    return current + (target - current) * (1 - Math.exp(-elapsedMs / timeConstant));
}

function peakToBarRatio(peak) {
    if (!Number.isFinite(peak) || peak <= 0) return 0;
    return Math.max(0, Math.min(1, (20 * Math.log10(peak) + 60) / 60));
}

function animateMeters(nowMs) {
    const elapsedMs = lastMeterFrameAt ? Math.min(100, nowMs - lastMeterFrameAt) : 16.7;
    lastMeterFrameAt = nowMs;
    const metrics = nowMs - metricsReceivedAt < 1000 ? latestMetrics : null;
    const leftPeak = metrics?.leftPeak ?? 0;
    const rightPeak = metrics?.rightPeak ?? 0;
    // Digital amplitude is logarithmic; this is not a measurement of amplifier watts.
    const needleAngle = value => metrics?.source === "simulator"
        ? -55 + value * 109 : amplitudeToNeedleAngle(value);
    ccSpectrumStatus.textContent =
        !metrics ? "NO AUDIO DATA" : metrics.source === "simulator" ? "SIMULATED" : "LIVE / 2CH";
    leftLevel = approach(leftLevel, needleAngle(leftPeak), elapsedMs, 133, 133);
    rightLevel = approach(rightLevel, needleAngle(rightPeak), elapsedMs, 133, 133);

    // The two compact bars show stereo sample peaks on the same -60..0 dBFS
    // visual range as the analyzer. They remain visible in both CC-1 views.
    [leftPeak, rightPeak].forEach((peak, index) => {
        ccStereoLevels[index] = approach(ccStereoLevels[index], peakToBarRatio(peak), elapsedMs, 35, 110);
        ccStereoFills[index].style.width = `${ccStereoLevels[index] * 100}%`;
    });

    if (!metrics) {
        // No recent audio data means the estimate is unknown, not zero watts.
        if (pcAmps) pcAmps.textContent = "—";
        if (pcVA) pcVA.textContent = "—";
        if (pcWatts) pcWatts.textContent = "—";
        if (pcPowerFactor) pcPowerFactor.textContent = "—";
    } else {
        // The estimator already rounded these to PC-1's displayed precision;
        // keep its values together so V*A ~= VA and VA*PF ~= W on the panel.
        if (pcAmps) pcAmps.textContent = latestPowerLoad.amps.toFixed(2);
        if (pcVA) pcVA.textContent = String(latestPowerLoad.va);
        if (pcWatts) pcWatts.textContent = String(latestPowerLoad.watts);
        if (pcPowerFactor) pcPowerFactor.textContent = latestPowerLoad.powerFactor.toFixed(2);
    }

    if (spectrumActive) {
        const barHeight = ccSpectrumBars.clientHeight || 1;
        ccSpectrumBarValues.forEach((level, index, values) => {
            const target = metrics?.spectrumBands?.[index] ?? 0;
            // React quickly to incoming ~30 Hz analysis frames; ease the fall
            // just enough to remain readable without hiding musical attacks.
            values[index] = approach(level, target, elapsedMs, 35, 105);
            if (target >= ccSpectrumPeakValues[index]) {
                ccSpectrumPeakValues[index] = target;
                ccSpectrumPeakTimes[index] = nowMs;
            } else if (nowMs - ccSpectrumPeakTimes[index] > 150) {
                ccSpectrumPeakValues[index] = approach(ccSpectrumPeakValues[index], target, elapsedMs, 180, 180);
            }
            const levelPercent = Math.max(0, values[index] * 100);
            const peakPercent = Math.max(levelPercent, ccSpectrumPeakValues[index] * 100);
            ccSpectrumBarElements[index].style.height = `${levelPercent}%`;
            const peakOffset = Math.max(0, (peakPercent - levelPercent) / 100 * barHeight * (metrics?.source === "simulator" ? .35 : 1));
            ccSpectrumBarElements[index].style.setProperty("--peak-offset", `${peakOffset}px`);
            ccSpectrumBarElements[index].style.setProperty("--peak-visible", peakPercent > 1 ? "1" : "0");
        });
    }

    leftNeedle.style.transform = `rotate(${leftLevel}deg)`;
    rightNeedle.style.transform = `rotate(${rightLevel}deg)`;
    requestAnimationFrame(animateMeters);
}

requestAnimationFrame(animateMeters);

// Keep the floorstanders as tall as the full component stack.
const listeningRoom = document.querySelector(".listening-room");
const rack = listeningRoom.querySelector(".rack");
const syncSpeakerHeight = () => {
    listeningRoom.style.setProperty("--rack-height", `${rack.getBoundingClientRect().height}px`);
};
syncSpeakerHeight();
new ResizeObserver(syncSpeakerHeight).observe(rack);

// A discreet display shortcut: C fits or removes both speaker grilles.
window.addEventListener("keydown", event => {
    if (event.key.toLowerCase() !== "c" || event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.target instanceof HTMLElement &&
        (event.target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName))) return;
    listeningRoom.classList.toggle("speaker-covers-on");
});
