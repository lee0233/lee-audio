const track = document.getElementById("track");
const artist = document.getElementById("artist");
const album = document.getElementById("album");

const leftNeedle = document.getElementById("leftNeedle");
const rightNeedle = document.getElementById("rightNeedle");

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

    document.title =
        data.artist
            ? `${data.track} — ${data.artist}`
            : "LEE AUDIO";
});

socket.addEventListener("close", () => {
    track.textContent = "Connection lost";
    artist.textContent = "";
    album.textContent = "";
});

/*
 * Temporary simulated meters.
 * These will eventually be replaced by actual L/R audio levels.
 */
function animateMeters() {
    const left = -38 + Math.random() * 65;
    const right = -38 + Math.random() * 65;

    leftNeedle.style.transform = `rotate(${left}deg)`;
    rightNeedle.style.transform = `rotate(${right}deg)`;
}

setInterval(animateMeters, 120);