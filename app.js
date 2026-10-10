const RoonApi = require("node-roon-api");
const RoonApiTransport = require("node-roon-api-transport");

const express = require("express");
const path = require("path");
const fs = require("fs");
const { execFile, execFileSync } = require("child_process");
const { WebSocketServer } = require("ws");
const { AudioMetricsHub, SimulatorProvider } = require("./lib/audio-metrics");

const { CoreAudioProvider } = require("./lib/coreaudio-provider");

const TARGET_ZONE = "Topping DX5";

// -------------------------------------------------------
// Web server
// -------------------------------------------------------

const web = express();

web.use(express.static(path.join(__dirname, "public")));

const server = web.listen(8080, () => {
    console.log("LEE AUDIO display: http://localhost:8080");
});

// -------------------------------------------------------
// WebSocket server
// -------------------------------------------------------

const wss = new WebSocketServer({ server });

let captureStatus = { type: "audio-status", state: "connecting", message: "Starting audio provider" };
const provider = process.env.LEE_AUDIO_PROVIDER === "simulator" ? new SimulatorProvider() : new CoreAudioProvider({
    onStatus(status) {
        captureStatus = { type: "audio-status", ...status };
        console.log(`[audio] ${status.message}`);
        broadcast(captureStatus);
    }
});
const audioMetrics = new AudioMetricsHub(provider);
audioMetrics.on("metrics", metrics => broadcast(metrics));

let currentTrack = null;
let currentZone = null;
let currentOutput = null;
let roonTransport = null;
let coreAudioProbe = null;

function startCoreAudioProbe() {
    if (process.platform !== "darwin") return;

    const source = path.join(__dirname, "scripts", "coreaudio-format.swift");
    const binary = path.join("/tmp", "lee-audio-coreaudio-format");

    try {
        if (!fs.existsSync(binary) || fs.statSync(source).mtimeMs > fs.statSync(binary).mtimeMs) {
            const cache = "/tmp/lee-audio-swift-cache";
            fs.mkdirSync(cache, { recursive: true });
            execFileSync("swiftc", [source, "-O", "-o", binary], {
                stdio: "ignore",
                env: { ...process.env, CLANG_MODULE_CACHE_PATH: cache }
            });
        }
        coreAudioProbe = binary;
        console.log("Watching Mimas CoreAudio output...");
    } catch (error) {
        console.log("CoreAudio format probe unavailable; using Roon metadata fallback.");
        return;
    }

    const poll = () => {
        execFile(coreAudioProbe, [], (error, stdout) => {
            if (!error && currentTrack) {
                try {
                    const data = JSON.parse(stdout.trim());
                    if (data.sampleRate && data.channels) {
                        const rate = Number(data.sampleRate);
                        const rateText = rate >= 1000
                            ? `${Number((rate / 1000).toFixed(1))} kHz`
                            : `${rate} Hz`;
                        const bitsText = data.bits ? `${data.bits}-bit` : "";
                        const channelText = `${data.channels} ch`;
                        const format = [rateText, bitsText, channelText].filter(Boolean).join(" · ");
                        if (currentTrack.format !== format) {
                            currentTrack.format = format;
                            broadcast(currentTrack);
                        }
                    }
                } catch { /* keep the last known format */ }
            }
            setTimeout(poll, 2000);
        });
    };

    poll();
}

function broadcast(data) {
    const message = JSON.stringify(data);

    for (const client of wss.clients) {
        if (client.readyState === 1) {
            client.send(message);
        }
    }
}

wss.on("connection", (socket) => {
    console.log("Display connected");
    socket.send(JSON.stringify(captureStatus));

    if (currentTrack) {
        socket.send(JSON.stringify(currentTrack));
    }

    socket.on("message", raw => {
        if (!roonTransport || !currentZone) return;
        let request;
        try { request = JSON.parse(raw.toString()); } catch { return; }
        if (request.control === "seek") {
            const seconds = Number(request.seconds);
            if (currentTrack?.length > 0 && Number.isFinite(seconds)) {
                roonTransport.seek(currentZone, "absolute", Math.max(0, Math.min(currentTrack.length, seconds)), error => {
                    if (error) console.error(`Seek failed: ${error}`);
                });
            }
            return;
        }

        if (request.control === "volume") {
            const value = Number(request.value);
            if (currentOutput?.volume && Number.isFinite(value)) {
                const volume = currentOutput.volume;
                roonTransport.change_volume(
                    currentOutput,
                    "absolute",
                    Math.max(volume.min, Math.min(volume.max, value)),
                    error => { if (error) console.error(`Volume change failed: ${error}`); }
                );
            }
            return;
        }

        if (request.control === "mute") {
            if (currentOutput?.volume) {
                roonTransport.mute(currentOutput, currentOutput.volume.is_muted ? "unmute" : "mute", error => {
                    if (error) console.error(`Mute change failed: ${error}`);
                });
            }
            return;
        }

        const controls = new Set(["previous", "playpause", "next"]);
        if (!controls.has(request.control)) return;
        roonTransport.control(currentZone, request.control, error => {
            if (error) console.error(`Transport control failed: ${error}`);
        });
    });
});

// -------------------------------------------------------
// Image Processing
// -------------------------------------------------------

let roonCore = null;

// -------------------------------------------------------
// Roon
// -------------------------------------------------------

const roon = new RoonApi({
    extension_id: "com.lee0233.lee-audio",
    display_name: "LEE AUDIO",
    display_version: "0.2.0",
    publisher: "Lee Dolby",
    email: "",

    core_paired: (core) => {
        roonCore = core;

        console.log(`LEE AUDIO connected to ${core.display_name}`);

        const transport = core.services.RoonApiTransport;
        roonTransport = transport;

        transport.subscribe_zones((cmd, data) => {

            if (cmd === "Subscribed") {
                console.log("Watching Topping DX5...");

                const zone = data.zones.find(
                    z => z.display_name === TARGET_ZONE
                );

                if (zone) {
                    updateNowPlaying(zone);
                }
            }

            if (cmd === "Changed" && data.zones_changed) {
                for (const zone of data.zones_changed) {
                    if (zone.display_name === TARGET_ZONE) {
                        updateNowPlaying(zone);
                    }
                }
            }

            if (cmd === "Changed" && data.zones_seek_changed) {
                for (const change of data.zones_seek_changed) {
                    if (currentZone && change.zone_id === currentZone.zone_id && currentTrack) {
                        currentTrack.seekPosition = change.seek_position || 0;
                        broadcast(currentTrack);
                    }
                }
            }
        });
    },

core_unpaired: (core) => {
    roonCore = null;
    console.log(`Disconnected from ${core.display_name}`);
}
});

function updateNowPlaying(zone) {

    currentZone = zone;
    currentOutput = zone.outputs?.[0] || null;

    const nowPlaying = zone.now_playing;

    if (!nowPlaying) {
        currentTrack = {
            type: "now-playing",
            state: zone.state,
            track: "Nothing playing",
            artist: "",
            album: ""
        };

        broadcast(currentTrack);
        return;
    }

    const track = nowPlaying.three_line?.line1 || "Unknown";
    const artist = nowPlaying.three_line?.line2 || "";
    const album = nowPlaying.three_line?.line3 || "";
    const sameTrack = currentTrack && currentTrack.track === track &&
        currentTrack.artist === artist && currentTrack.album === album;
    const fallbackFormat = (track.match(/\(([^)]+(?:kHz|Hz)[^)]*)\)/i)?.[1] || "FORMAT");

    currentTrack = {
        type: "now-playing",
        state: zone.state,
        track,
        artist,
        album,

        // Preserve the CoreAudio-derived format across volume/state-only Roon events.
        format: sameTrack && currentTrack.format && currentTrack.format !== "FORMAT"
            ? currentTrack.format
            : fallbackFormat,

        length:
            nowPlaying.length || 0,

        seekPosition:
            nowPlaying.seek_position || 0,

        imageKey: 
            nowPlaying.image_key || null,

        volume: currentOutput?.volume ? {
            type: currentOutput.volume.type,
            min: currentOutput.volume.min,
            max: currentOutput.volume.max,
            value: currentOutput.volume.value,
            isMuted: currentOutput.volume.is_muted
        } : null
    };

    console.log(
        `♫ ${currentTrack.track} — ${currentTrack.artist}`
    );

    broadcast(currentTrack);
}

roon.init_services({
    required_services: [
        RoonApiTransport
    ]
});

roon.start_discovery();

startCoreAudioProbe();

console.log("LEE AUDIO starting...");

// Defer compilation until the server has initialized.
setImmediate(() => audioMetrics.start());
for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => { audioMetrics.stop(); server.close(); setTimeout(() => process.exit(0), 300); });
}
