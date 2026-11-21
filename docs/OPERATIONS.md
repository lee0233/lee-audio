# Audio Monitor — Operations and verification

**Scope:** current codebase (2026-11-20) plus a list of operational checks. Mac startup automation and CALLISTO visualizer deployment remain **planned**, not implemented.

## Source of truth

- [Architecture](ARCHITECTURE.md): current components, data flows, measured vs modeled behavior and target state.
- [Backlog](../BACKLOG.md): priorities, decisions pending and explicit acceptance criteria.
- [README](../README.md): capture details, calibration assumptions and current verification guidance.
- GitHub contains application code/configuration and reviewed docs; Roon Server configuration lives on CALLISTO; macOS permissions/startup configuration live on MIMAS.

## Known-good incident recovery observation

2026-11-20: TOPPING DX5 vanished as a Roon zone on TRITON. MIMAS was powered but at a login screen. After login, DX5 zone returned. This is evidence of a startup/session issue, **not proof** an OS update occurred. Do not reboot Roon Server or change NAS Docker configuration as a first response.

Check sequentially:
1. Is Roon Server on CALLISTO reachable from the TRITON Roon controller?
2. Under Roon Settings → Audio, is the MIMAS-connected DX5 endpoint advertised, disabled or absent? Ignore unrelated stale local ASIO devices shown under TRITON.
3. Is MIMAS powered, reachable over LAN and logged in? Is its Roon/Roon Bridge endpoint process running?
4. Does macOS see the USB DX5 and can Roon play to it?
5. If the visualizer alone is broken, check its Node service and macOS capture permission separately from Roon playback.
6. Record the symptom and recovery; avoid random restarts across the architecture.

**Do not assume** a lit Mac Mini power LED proves the user session, endpoint and audio-capture service are operational.

## Source checkout: current developer run

On MIMAS with suitable Node/npm and Swift/Xcode command-line tools installed:

```bash
npm ci
node app.js
```

Then visit `http://localhost:8080` from MIMAS or `http://MIMAS:8080` from a reachable LAN browser (subject to DNS/firewall). The code binds port 8080. Ensure Roon has authorized the extension. The native helper is built on first use; grant macOS audio recording permission if asked.

**Current repo does not supply a confirmed background service, Docker Compose file, production launch agent or safe authenticated reverse proxy.** The command above is an interactive developer run, not a finished headless deployment.

### Diagnostics

```bash
# Confirm device and sample/bit-depth readout (Mac only)
swift scripts/coreaudio-format.swift

# After app compiles the native capture binary
.cache/audio-capture --list
.cache/audio-capture --self-test

# Run JS tests
node --test test/*.test.js

# Explicit simulated demo (NOT real meters)
LEE_AUDIO_PROVIDER=simulator node app.js
```

The Swift format probe prints JSON for the current **default** macOS output, which may differ from the DX5 if another device is selected. Capture selects a DX5-matching device by name; review the device list before relying on the readings.

If capture reports NO AUDIO DATA, verify privacy permission, output device, Roon playback, helper build/signing and stderr. A quiet track or pause can produce **valid zero frames**; a stopped/unavailable capture is different.

On macOS, check **System Settings → Privacy & Security → Screen & System Audio Recording** for permission. An initial request may require a logged-in user; unattended boot should be tested after permissions are granted.

## Headless MIMAS checklist (not yet verified complete)

- [ ] Confirm FileVault status (user reported **Off** on 2026-11-20).
- [ ] Confirm auto-login / secure unattended session strategy; document exposure of an automatically unlocked desktop.
- [ ] Verify exactly which Roon endpoint app runs on MIMAS and add startup mechanism.
- [ ] Verify macOS sleep prevention, power-failure recovery and USB DAC reconnection.
- [ ] Enable and validate macOS Screen Sharing (VNC) from TRITON over local network; never forward VNC to the public internet.
- [ ] Investigate boot-time vs logged-in restrictions on CoreAudio tap permissions and launch agents.
- [ ] Cold boot without interaction, connect from TRITON, play audio and verify DX5 zone returns.

## Migration safety and security

- Keep live Roon Server container on CALLISTO unchanged while migrating Audio Monitor.
- Preserve original local behavior until new deployment passes end-to-end acceptance.
- Record exact host addresses, port mappings, service accounts, launch plist names and filesystem paths **only after verifying on the actual devices**.
- **Security finding:** tracked `config.json` currently contains Roon extension pairing credentials/token material. Treat as sensitive: remove from version control, ignore local generated state, and determine whether pairings must be revoked/reauthorized. Since it is already in Git history, merely deleting it from the latest commit does not erase historical exposure. Do not quote credentials in issues or documentation. Schedule remediation before public sharing / production hardening.
- WebSocket control handlers currently accept commands from any connected browser client; plan LAN restriction and suitable access control before broad exposure.
- The frontend currently hardcodes a LAN Roon image endpoint; externalize it for Docker deployment, and review compatibility with artwork URLs.
- No secrets, raw audio, or generated binaries in commits. `config.json` must not remain a tracked secret-bearing file.

## Verification checklist after any change

- Roon Server on CALLISTO still accessible; DX5 audio plays through MIMAS.
- Track, artist, album, artwork, state, progress and supported controls match Roon.
- Real capture reports `LIVE / 2CH`; pause/silence decay as expected; no silent simulator fallback.
- Stereo bars and 24 spectrum bands respond to signal; 44.1/48/192 kHz transitions recover.
- PA-1 watt scale and PC-1 modeled electrical values are not represented as actual measured speaker/wall watts.
- Browser reconnect and recovery tested after endpoint, app and network interruptions.
- Document any failed checks before marking a backlog item complete.
