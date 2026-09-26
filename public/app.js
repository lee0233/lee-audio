const track = document.getElementById("track");
const artist = document.getElementById("artist");
const album = document.getElementById("album");
const artwork = document.getElementById("artwork");

const leftNeedle = document.getElementById("leftNeedle");
const rightNeedle = document.getElementById("rightNeedle");

const NS = "http://www.w3.org/2000/svg";

/* Decorative power scale: 0 dB = 150 W; P = 150 * 10 ** (dB / 10).
 * Watt labels are rounded. Needle movement remains a simulation.
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

    if (data.type !== "now-playing") return;

    track.textContent = data.track;
    artist.textContent = data.artist;
    album.textContent = data.album;

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

socket.addEventListener("close", () => {
    track.textContent = "Connection lost";
    artist.textContent = "";
    album.textContent = "";
});


// -------------------------------------------------------
// Temporary meter simulation
// -------------------------------------------------------

let leftLevel = -25;
let rightLevel = -23;

function animateMeters() {

    const leftTarget = -45 + Math.random() * 85;
    const rightTarget = -45 + Math.random() * 85;

    leftLevel += (leftTarget - leftLevel) * 0.22;
    rightLevel += (rightTarget - rightLevel) * 0.22;

    leftNeedle.style.transform =
        `rotate(${leftLevel}deg)`;

    rightNeedle.style.transform =
        `rotate(${rightLevel}deg)`;
}

setInterval(animateMeters, 55);