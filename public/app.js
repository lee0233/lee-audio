const track = document.getElementById("track");
const artist = document.getElementById("artist");
const album = document.getElementById("album");
const artwork = document.getElementById("artwork");

const leftNeedle = document.getElementById("leftNeedle");
const rightNeedle = document.getElementById("rightNeedle");

const NS = "http://www.w3.org/2000/svg";

/*
 * Meter geometry
 *
 * Pivot: 500,455
 * Scale radius: ~330px
 * Sweep: -55° to +55°
 */

const markings = [
    { value: "-50", angle: -55 },
    { value: "-40", angle: -46 },
    { value: "-30", angle: -37 },
    { value: "-20", angle: -27 },
    { value: "-10", angle: -16 },
    { value: "-5",  angle:  -7 },
    { value: "-3",  angle:   2 },
    { value: "-1",  angle:  12 },
    { value: "0",   angle:  23 },
    { value: "+1",  angle:  34 },
    { value: "+2",  angle:  44 },
    { value: "+3",  angle:  54 }
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

    markings.forEach(mark => {

        const inner = point(mark.angle, 315);
        const outer = point(mark.angle, 345);
        const label = point(mark.angle, 375);

        const tick = document.createElementNS(NS, "line");

        tick.setAttribute("x1", inner.x);
        tick.setAttribute("y1", inner.y);
        tick.setAttribute("x2", outer.x);
        tick.setAttribute("y2", outer.y);
        tick.setAttribute("class", "scale-line");

        group.appendChild(tick);

        const number = document.createElementNS(NS, "text");

        number.setAttribute("x", label.x);
        number.setAttribute("y", label.y);
        number.setAttribute("class", "scale-number");

        number.textContent = mark.value;

        group.appendChild(number);
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