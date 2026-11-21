# Audio Monitor — Architecture and implementation baseline

**Status:** AS-IS documentation of repository `lee0233/lee-audio` on 2026-11-20. Design changes are tracked in [BACKLOG.md](../BACKLOG.md); do not confuse future state with running infrastructure.

## Architectural principle

**Roon owns music, library, zones and playback. Audio Monitor owns visualization and audio-level analysis.**

Audio Monitor is a custom McIntosh-inspired web dashboard. It is **not** another Roon Server, player, library scanner or independent playback engine.

## Physical and runtime boundaries

| Component | Location | Responsibility | Current state |
| --- | --- | --- | --- |
| CALLISTO | UGREEN NAS | Roon Server running in Docker, authoritative library, zones and playback service | User-confirmed existing deployment; not managed by this repository |
| MIMAS | Apple Mac Mini M4 | USB-connected TOPPING DX5; Roon-compatible audio endpoint; existing Audio Monitor Node app and native Swift capture | Current operating arrangement based on discussion and source code. Exact Roon/Roon Bridge binary and launch mechanism **not yet verified** |
| TOPPING DX5 | USB attached to MIMAS | Playback DAC and target CoreAudio output device | User confirmed that logging into MIMAS restored Roon zone discovery |
| TRITON | Windows Alienware laptop | Roon controller; also capable of viewing Audio Monitor browser UI | User-confirmed |
| Browser | On a computer reachable over LAN | Dashboard UI, real-time meters, Roon controls | HTML/CSS/JS served from Node app |

**Regression observed:** MIMAS was found at the macOS login screen, and the TOPPING zone was missing from Roon on TRITON. After login it returned. The precise root cause—reboot after update, startup setting, login-session dependency or another factor—remains **unverified**. The immediate priority is unattended recovery, not moving Roon Server.

## Current application stack — source verified

- **Node.js / CommonJS + Express 5:** `app.js` starts an HTTP server on port **8080**, serving `public/` as static files.
- **WebSocket (`ws`):** same HTTP server upgrades connections for real-time messages and browser control commands.
- **Roon extension:** uses `node-roon-api`, `node-roon-api-transport`, and installed `node-roon-api-image` package. Roon extension ID is `com.lee0233.lee-audio`; internal display name remains LEE AUDIO.
- **Native macOS audio capture:** `scripts/audio-capture.swift` uses CoreAudio process taps and Apple's Accelerate/vDSP. `lib/coreaudio-provider.js` builds and launches it.
- **CoreAudio format probe:** `scripts/coreaudio-format.swift` is compiled and polled to report device output format. When unavailable, UI can fall back to track text for format.
- **Frontend:** `public/index.html`, `public/styles.css`, `public/app.js`, and `public/power-model.js`.
- **Testing:** Node test files in `test/`; native capture helper supports `--self-test`.

**Correction to early discussion:** the checked-in backend is **Node/Express**, not Python. A Python rewrite is neither required nor proposed.

## Data flows

```text
                             CALLISTO (NAS)
                        Roon Server (Docker)
                              |
                     Roon extension APIs
                 zone + metadata + controls
                              |
MIMAS (Mac Mini)              v
TOPPING DX5 <--- Roon endpoint / CoreAudio output
    |                         |
    +---- CoreAudio tap ---- Swift capture helper
                                  |
                          JSON lines on stdout
                                  |
                      lib/coreaudio-provider.js
                                  |
                        lib/audio-metrics.js
                                  |
                     app.js (Node + WebSocket)
                                  |
                       HTTP 8080 / WS 8080
                                  |
                    Browser on TRITON or MIMAS
```

The location of the existing Node app on MIMAS is consistent with its local CoreAudio requirement; its actual installed service/startup path has not been independently inspected. Docker on CALLISTO is **future state**, not current state.

## Roon state, event handling and control

In `app.js`:
- Roon discovers and pairs to an available core via Roon's Node API. Pairing is stored in a local `config.json` created/used by the extension machinery.
- Code targets **exactly** the zone display name `Topping DX5` (constant `TARGET_ZONE`). A zone rename can break tracking.
- `subscribe_zones` handles initial subscription, zone changes and seek-position updates.
- Now-playing payload contains playback state, track, artist, album, duration, seek position, artwork `imageKey`, and output volume (if supported).
- Browser sends WebSocket control commands: previous, play/pause, next, seek, absolute volume and mute; Node forwards to Roon Transport API, not a custom player.
- Browser image URL currently contains a **hard-coded LAN Roon image endpoint** in `public/app.js`. This needs configurable routing before migration. Verify image service behavior; the presence of an image dependency alone does not prove it is used on the server.
- Current implementation uses first output of the selected zone for volume control; multi-output handling is not designed.

## Live audio metrics

`lib/coreaudio-provider.js`:
1. On macOS, compiles `scripts/audio-capture.swift` to `.cache/audio-capture` if necessary, with CoreAudio and Accelerate, embeds an info plist, then ad-hoc codesigns it.
2. Spawns the helper; reads one JSON measurement per stdout line; stderr is diagnostic.
3. Notifies clients of connecting/live/unavailable/error status.
4. If helper exits, retries in **5 seconds**. Missing initial frames produce an unavailable message after **10 seconds**.
5. Requires macOS **Screen & System Audio Recording** permission for the capture process / launching application.

`scripts/audio-capture.swift`:
- Selects output device by partial name: `LEE_AUDIO_DEVICE` environment variable, default **DX5**; refuses ambiguous/missing matches. `--list` enumerates devices.
- Creates a private, **unmuted** CoreAudio process tap, not an alternate playback route; no raw PCM saved to disk.
- Analyzes stereo float PCM with **4096-sample Hann window**, vDSP FFT, and 24 log-spaced frequency bands **63 Hz–12.5 kHz**.
- Emits roughly **30 frames/s** with left/right sample peaks and RMS, spectrum, sample rate, channels, source and epoch-ms timestamp.
- Detects tap format changes; exits cleanly so the JS supervisor can restart it.
- Provides `--self-test` for synthetic 1 kHz, RMS, stereo isolation and silence.

`lib/audio-metrics.js` normalizes/clamps frames and supplies a provider abstraction (`subscribe`, `start`, `stop`). Setting `LEE_AUDIO_PROVIDER=simulator` explicitly selects the simulated provider. **Failure of live capture does not silently switch to simulator.**

### Truth in presentation

| Display | Source / interpretation |
| --- | --- |
| PA-1 moving needles | **Live digital sample peaks**, mapped onto a decorative watt/dB scale; **not measured amplifier watts** |
| CC-1 L/R signal strips | Real stereo **RMS** level when live capture is available |
| CC-1 spectrum | Real 24-band FFT measurements when live capture is available |
| CC-1 volume | Roon output volume if exposed by API |
| PC-1 load/current/VA/power factor | **Simulation/model**, driven partly by real audio RMS and assumed hardware power budgets; **not a wall-power meter** |
| Track/album/artwork/seek | Roon's playback metadata / image service |
| Balance knob | Placeholder; not wired to DAC or Roon |

Frontend explicitly labels data as `LIVE / 2CH`, `SIMULATED` or `NO AUDIO DATA`. Preserve these semantics in any redesign. Browser animation operates at display refresh rate and uses time-based rise/fall smoothing; analysis stream is slower (~30 Hz).

## Deployment and configuration facts

| Setting | Current behavior |
| --- | --- |
| Start command | `node app.js` from repo root |
| Default HTTP/WS port | `8080` (hard-coded in current `app.js`) |
| DAC selector | `LEE_AUDIO_DEVICE` (default `DX5`) |
| Demo mode | `LEE_AUDIO_PROVIDER=simulator node app.js` |
| UI | `http://<host-running-node>:8080` |
| Roon zone | Exact name `Topping DX5` |
| Roon extension identity | `com.lee0233.lee-audio` |
| Build artifacts | `.cache/` for audio capture, `/tmp` for format probe |
| Authorization | Roon extension pairing, plus macOS system-audio recording permission |
| Current containerization | **None for Audio Monitor confirmed**; only Roon Server is confirmed Docker-hosted |

Do not confuse the **Roon Server container** with the currently Mac-hosted Audio Monitor app.

## Future target — not implemented

- CALLISTO runs a separate Node/Express Audio Monitor Docker container; Roon Server remains separate and unchanged.
- MIMAS runs the native Swift/CoreAudio capture as a small unattended agent beside the Roon audio endpoint.
- Agent sends **measurements (not raw audio)** across the LAN; container relays them to browsers. Transport and authentication are not yet selected.
- Remove hard-coded host/zone assumptions, preserve Roon API integration, add health checks and startup automation.
- Do not assume native macOS CoreAudio can execute in Linux Docker.
- Acceptance: cold boot MIMAS without interaction → DX5 appears in Roon on TRITON → playback works → browser on TRITON receives real live meters from Audio Monitor hosted on CALLISTO.

See [BACKLOG.md](../BACKLOG.md) for task priorities and acceptance criteria.
