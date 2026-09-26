const RoonApi = require("node-roon-api");
const RoonApiTransport = require("node-roon-api-transport");

const express = require("express");
const path = require("path");
const fs = require("fs");
const { execFile, execFileSync } = require("child_process");
const { WebSocketServer } = require("ws");

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

let currentTrack = null;
let currentZone = null;
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

    currentTrack = {
        type: "now-playing",
        state: zone.state,

        track:
            nowPlaying.three_line?.line1 ||
            "Unknown",

        artist:
            nowPlaying.three_line?.line2 ||
            "",

        album:
            nowPlaying.three_line?.line3 ||
            "",

        format:
            (nowPlaying.three_line?.line1 || "").match(/\(([^)]+(?:kHz|Hz)[^)]*)\)/i)?.[1] ||
            "FORMAT",

        length:
            nowPlaying.length || 0,

        seekPosition:
            nowPlaying.seek_position || 0,

        imageKey: 
            nowPlaying.image_key || null
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
