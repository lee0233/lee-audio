const RoonApi = require("node-roon-api");
const RoonApiTransport = require("node-roon-api-transport");

const TARGET_ZONE = "Topping DX5";

const roon = new RoonApi({
    extension_id: "com.lee0233.lee-audio",
    display_name: "LEE AUDIO",
    display_version: "0.1.0",
    publisher: "Lee Dolby",
    email: "",

    core_paired: (core) => {
        console.log(`\nLEE AUDIO connected to ${core.display_name}`);

        const transport = core.services.RoonApiTransport;

        transport.subscribe_zones((cmd, data) => {

            if (cmd === "Subscribed") {
                console.log("\nWatching Topping DX5...\n");

                const zone = data.zones.find(
                    z => z.display_name === TARGET_ZONE
                );

                if (zone) showTrack(zone);
            }

            if (cmd === "Changed") {

                if (data.zones_changed) {
                    for (const zone of data.zones_changed) {
                        if (zone.display_name === TARGET_ZONE) {
                            showTrack(zone);
                        }
                    }
                }
            }
        });
    },

    core_unpaired: (core) => {
        console.log(`Disconnected from ${core.display_name}`);
    }
});

function showTrack(zone) {

    const nowPlaying = zone.now_playing;

    console.log("--------------------------------");

    if (!nowPlaying) {
        console.log("Nothing playing");
        return;
    }

    console.log(`Track:  ${nowPlaying.three_line?.line1 || "Unknown"}`);
    console.log(`Artist: ${nowPlaying.three_line?.line2 || "Unknown"}`);
    console.log(`Album:  ${nowPlaying.three_line?.line3 || "Unknown"}`);
    console.log(`State:  ${zone.state}`);

    if (nowPlaying.length) {
        console.log(`Length: ${nowPlaying.length}s`);
    }

    console.log("--------------------------------");
}

roon.init_services({
    required_services: [RoonApiTransport]
});

roon.start_discovery();

console.log("LEE AUDIO starting...");