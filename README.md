# lee-audio
Roon Audio Visualization Engine


## Live audio meters (macOS)

Run `node app.js` from your regular terminal, then reload the browser. The server
builds and ad-hoc signs `scripts/audio-capture.swift` in `.cache/` on first launch.
Allow macOS system audio recording when prompted. If capture is unavailable,
check System Settings → Privacy & Security → Screen & System Audio Recording
(the wording depends on macOS), and grant access to the launching app if listed.
Restart the server after changing permission.

The capture helper uses a private, unmuted CoreAudio device tap for the output
whose name contains `DX5`. It does not reroute playback, set volume, save audio,
or send samples over the network. All apps playing to that device are included.
To choose another output, set `LEE_AUDIO_DEVICE` to a unique part of its name.
After the helper is built, `.cache/audio-capture --list` lists available devices.

`LEE_AUDIO_PROVIDER=simulator node app.js` explicitly enables the demo provider.
A failed live capture never automatically falls back to simulated movement.
The analyzer reports LIVE / 2CH only after receiving frames; NO AUDIO DATA means
frames are absent or stale. Silence produces valid zero-valued frames.

### Measurement contract

`lib/audio-metrics.js` is the provider boundary. Providers implement
`subscribe(callback)` (returning an unsubscribe function), `start()`, and `stop()`.
Frames contain linear left/right sample peak and RMS amplitudes (0–1), 24 spectrum
bands, sample rate, channels, timestamp in epoch milliseconds, and source.
Spectrum centers run logarithmically from 63 Hz to 12.5 kHz; band values map
−60 to 0 dBFS onto 0–1. Stereo FFT powers are averaged before band selection
so out-of-phase stereo content does not cancel. Analysis uses a 4096-sample Hann
window, targeting 30 updates per second. Low-frequency resolution is limited
at high sample rates; the native analysis can be refined independently of the UI.

The browser draws at the display refresh rate and gives the spectrum a quick
rise and short peak hold. CC-1 shows live stereo RMS strips in both display
views and the same Roon volume value on its volume and spectrum screens. The
simulator emits at roughly 30 updates per second as well. PA-1 follows
digital audio peaks: its watt scale assumes a calibrated amplifier input and is
not measured speaker power. PC-1 uses a separate, slower simulated mains-load
model for the whole rack. Only the PA-1's variable load follows the two
channels' RMS levels; the other active devices have provisional fixed loads.
It still does not measure wall power.

### PC-1 load simulation

The audio-level calibration still uses a DX5 balanced-output proxy, an MC152
balanced input, and B&W 702 S3 Signature speakers on the MC152's 4-ohm taps.
Topping specifies
4.2 Vrms at full scale; McIntosh specifies 2.4 Vrms balanced for 150 W per
channel. B&W specifies a nominal 8-ohm speaker with a 3.1-ohm minimum. The
MC152 is rated at 150 W per channel into its 2-, 4-, or 8-ohm taps, so the
speaker's impedance dip does not directly multiply the rated output watts.

The model converts digital RMS into an assumed amp input voltage and caps each
channel at the MC152's rated output. PA-1 is assigned 95 W active idle use plus
output power divided by 68% incremental efficiency. The other active-power
budgets are 20 W for DP-1 (modeled on the HiFi Rose RS130), 30 W for CC-1
(modeled on the McIntosh C53), and a provisional 15 W for PC-1 itself, giving
160 W at silence. The passive B&W speakers have no separate wall draw;
their demand is already represented in PA-1's output. Assumed power factors are
0.72–0.90 for PA-1, 0.92 for DP-1, 0.90 for CC-1, and 0.95 for PC-1. PC-1
smooths variable load changes with a 180 ms rise and 750 ms fall. The DP-1
budget rounds an RS130 lab reading of 18 W, and the CC-1 budget follows the
C53's published 30 W requirement. PA-1 idle use, PC-1 overhead, efficiency,
and power factors are **simulation assumptions**, not measured values. The
RS130 is a digital transport; its path through a C53 DAC and volume stage has
not yet been calibrated, so the DX5 voltage proxy remains provisional. The
display derives VA and W
from its displayed 0.01 A and power-factor precision. 100% digital volume does
not imply continuous rated amplifier output.

Sources: [MC152 owner manual](https://www.mcintoshlabs.com/-/media/Files/mcintoshlabs/DocumentMaster/us/mc152om01.pdf),
[DX5 owner manual](https://dl.topping.audio/usermanual/dx5_dx5l.pdf),
[B&W 702 S3 Signature specifications](https://www.bowerswilkins.com/en-gb/product/loudspeakers/702-s3-signature/FP43575.html),
[RS130 lab power measurement](https://www.hifinews.com/content/hifi-rose-rs130-music-librarystreamer-lab-report),
[C53 owner manual](https://www.mcintoshlabs.com/-/media/Files/mcintoshlabs/DocumentMaster/us/c53om-01.pdf).

The native helper reconnects after tap sample-rate/channel changes. A failed or
missing device is retried every five seconds.

The CC-1 balance knob is a visual placeholder until a supported control path is
available. It does not request USB access or alter the DX5 II.

### Verification

`node --test test/*.test.js`

After compilation: `.cache/audio-capture --self-test` checks a generated 1 kHz tone,
stereo isolation, RMS calibration, and silence without needing capture permission.
Hardware acceptance: play Roon through DX5, pause (meters fall), use stereo material,
and switch between 44.1/48/192 kHz tracks. Confirm LIVE / 2CH and changing bands.
Live permission/device behavior must be verified on the Mac outside the tool sandbox.
