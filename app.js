const RoonApi = require("node-roon-api");
const RoonApiTransport = require("node-roon-api-transport");

const express = require("express");
const path = require("path");
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
});

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
        console.log(`LEE AUDIO connected to ${core.display_name}`);

        const transport = core.services.RoonApiTransport;

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
        });
    },

    core_unpaired: (core) => {
        console.log(`Disconnected from ${core.display_name}`);
    }
});

function updateNowPlaying(zone) {

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

        length:
            nowPlaying.length || 0
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

console.log("LEE AUDIO starting...");