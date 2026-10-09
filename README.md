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
window, with about 20 updates per second. Low-frequency resolution is limited
at high sample rates; the native analysis can be refined independently of the UI.

The browser applies needle smoothing and peak-marker presentation. PA-1 follows
digital audio level: its existing watt scale is decorative, not measured amplifier
power. PC-1 amps remain a simulated load, even when driven by live levels.
The native helper reconnects after tap sample-rate/channel changes. A failed or
missing device is retried every five seconds.

### Verification

`node --test test/audio-metrics.test.js`

After compilation: `.cache/audio-capture --self-test` checks a generated 1 kHz tone,
stereo isolation, RMS calibration, and silence without needing capture permission.
Hardware acceptance: play Roon through DX5, pause (meters fall), use stereo material,
and switch between 44.1/48/192 kHz tracks. Confirm LIVE / 2CH and changing bands.
Live permission/device behavior must be verified on the Mac outside the tool sandbox.
