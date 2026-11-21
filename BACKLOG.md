# Audio Monitor — Backlog

> Repository currently named `lee-audio`. Planned name: `audio-monitor`.
> Status: planning backlog. No deployment or configuration changes are implied by this document.
> Updated: 2026-11-20 (America/New_York)

## Architecture baseline (verified / agreed)

- **CALLISTO:** UGREEN NAS; existing Roon Server runs in Docker. Keep it in place as the authoritative music/playback service.
- **MIMAS:** Mac Mini M4; TOPPING DX5 physically attached by USB; macOS is responsible for making that audio endpoint available to Roon.
- **TRITON:** Windows Roon controller and potential browser-based Audio Monitor display.
- **Current codebase:** Node.js/Express + HTML/CSS/JavaScript, Roon Node API extensions, Swift CoreAudio capture helper (`scripts/audio-capture.swift`), WebSocket library. Verify exact runtime paths before modification.
- **Audio-analysis contract:** true, per-channel peak and RMS, 24 FFT spectrum bands, ~30 frames/sec. Current macOS capture uses a CoreAudio process tap and emits JSON; preserve live vs simulated data provenance.
- **Operating principle:** Roon owns zones, metadata, artwork, playback and transport controls. Audio Monitor owns presentation and audio measurements. Avoid a duplicate music catalog or playback engine.
- **Incident motivating P0:** After finding MIMAS at the macOS login screen, logging in restored the TOPPING DX5 zone in Roon on TRITON. Suspected endpoint/session startup dependency; OS update/restart not yet confirmed.
- **FileVault:** user reported it disabled on MIMAS on 2026-11-20; verify as part of baseline rather than assume other configuration is complete.

## P0 — Headless MIMAS / reliable TOPPING endpoint

- [ ] **P0.1 — Baseline current endpoint/service and login behavior.** Determine whether MIMAS is running Roon or Roon Bridge, how it starts, how USB DX5 is exposed, what launches after reboot, and whether macOS updates caused the observed login screen. Record macOS version and launch mechanism. **Done when:** current startup chain and failure point are documented.
- [ ] **P0.2 — Configure unattended startup.** Choose a reliable supported startup mechanism for the Roon endpoint and required audio-capture service. Evaluate automatic desktop login vs user-session/launch-agent/daemon requirements (including macOS audio capture permissions). The user prefers no manual login; document physical-security trade-off. **Done when:** endpoint becomes available after a cold boot without manual login.
- [ ] **P0.3 — Keep MIMAS awake and recover after power outage.** Configure desktop Mac sleep settings, wake for network access, automatic power-on after failure where supported; verify USB DAC wake/reconnect. **Done when:** idle display/sleep and power recovery do not strand the Roon zone.
- [ ] **P0.4 — Unattended remote administration.** Validate macOS Screen Sharing/VNC from TRITON, authentication and local-network-only exposure; ensure accessibility after restarts. **Done when:** MIMAS can be administered without local peripherals.
- [ ] **P0.5 — Production recovery acceptance test.** From TRITON verify Roon library stays on CALLISTO; cold restart MIMAS; do *not* log in; verify MIMAS is reachable and TOPPING DX5 zone appears and plays; repeat after macOS update/restart and DAC USB disconnect/reconnect. **Done when:** every test passes, with timestamps and recovery notes.
- [ ] **P0.6 — Failure visibility.** Add a lightweight health/status mechanism to distinguish Roon Server availability, MIMAS endpoint availability, DX5 USB detection and CoreAudio capture health. **Done when:** failure location is clear without guessing or restarting CALLISTO.

## P1 — Rename and audit the actual application

- [ ] **P1.1 — Rename GitHub repository to `audio-monitor` (planned for next session).** Use GitHub Settings → General; update `git remote`, package metadata, documentation, CI/deployment URLs and any hard-coded repository references; verify GitHub redirect. **Do not rename before user is ready.** **Done when:** canonical URL is `https://github.com/lee0233/audio-monitor` and references work.
- [ ] **P1.2 — Review code and dependencies before selecting deployment design.** Map `app.js`, `lib/audio-metrics.js`, `scripts/audio-capture.swift`, frontend, Roon extension and WebSocket endpoints. Confirm current ownership of audio frames and Roon transport/events; identify Mac-specific assumptions. **Done when:** as-is diagram and migration change list exist.
- [ ] **P1.3 — Verify available Roon API features.** Use existing `node-roon-api` / transport / image packages for zone state, track/artist/album metadata, artwork, playback progress, and supported controls. Identify any unsupported behaviors before writing alternatives. **Done when:** API capability matrix with tested behaviors is recorded.

## P2 — Docker-hosted Audio Monitor on CALLISTO

- [ ] **P2.1 — Containerize the existing Node/Express web app.** Prefer migration of current JS/HTML/CSS rather than rewriting in Python or developing a separate native Windows UI. Create Dockerfile/Compose configuration, externalized settings, documented port, persistent state only if necessary; keep Roon Server in its separate existing container. **Done when:** browser UI loads from CALLISTO.
- [ ] **P2.2 — Separate CoreAudio provider from web host.** Retain a small native Swift/CoreAudio measurement agent on MIMAS, and deliver only analyzed JSON frames to the CALLISTO app across the LAN. Decide and document transport (e.g. authenticated WebSocket), reconnection, buffering, timing, and source identity. Do not transmit or store raw audio unless explicitly needed. **Done when:** live DX5 measurements reach container in expected schema with acceptable latency.
- [ ] **P2.3 — Implement remote measurement provider.** Reuse `lib/audio-metrics.js` provider contract (`subscribe/start/stop`) and frame schema (`leftPeak`, `rightPeak`, `leftRms`, `rightRms`, 24 `spectrumBands`, sample rate, channels, timestamp, source). Preserve LIVE/NO AUDIO DATA status semantics; simulation must be opt-in, not silent fallback. **Done when:** existing meters operate without CoreAudio on the NAS itself.
- [ ] **P2.4 — Connect container to Roon Server using existing Roon integration.** Validate LAN discovery/networking across Docker and any extension authorization required in Roon; avoid assuming container-to-container visibility or discovery without testing. **Done when:** zones, artwork, track state, volume (where supported), and playback controls behave as before.
- [ ] **P2.5 — Browser and display validation.** Check TRITON, MIMAS and optional tablet/browser resolutions; retain current McIntosh-inspired views, genuine meters, spectrum and explicit simulated PC-1 power model. **Done when:** functional parity with current desktop visualizer is demonstrated.

## Security finding — prioritized for remediation

- [ ] **P1.4 — Remove sensitive Roon pairing state from the tracked repository.** Current `config.json` includes pairing token material. Do not copy its contents into issues or documentation. Stop tracking/generated state via `.gitignore`; decide whether pairing credentials need revocation and whether history cleanup is warranted based on repository exposure. Test re-pairing after safe remediation. **Done when:** no live pairing token is tracked in the current tree and history/exposure have been assessed.
- [ ] **P2.6 — Secure Audio Monitor browser control surface.** Current WebSocket accepts transport/volume requests from connected clients; implement appropriate access controls/LAN boundaries before hosting on a NAS with wider reach. **Done when:** unauthorized clients cannot issue playback controls.

## P3 — Operational hardening and acceptance

- [ ] **P3.1 — Reliability and deployment:** restart policy (`unless-stopped` where appropriate), health checks, dependency/retry handling, LAN security, logs with rotation, configuration backup and recovery documentation. **Done when:** NAS and Mac reboots recover services without manual repair.
- [ ] **P3.2 — Audio correctness regression suite:** preserve `audio-capture --self-test` (1 kHz, stereo, RMS, silence) and JS tests; validate real music, paused playback, stereo balance and 44.1/48/192 kHz format transitions. **Done when:** meter status, signal values and dynamic sample-rate recovery are verified.
- [ ] **P3.3 — End-to-end failure injection:** restart only web container, only Roon Server, and MIMAS; interrupt USB and network; verify reconnection, no simulated frames misrepresented as live, and unaffected music playback where possible. **Done when:** pass/fail outcomes are recorded against each failure scenario.
- [ ] **P3.4 — Document architecture and runbook:** system diagram, ports, credentials handling, startup mechanism, endpoints, backup/redeploy steps, and troubleshooting sequence. **Done when:** a fresh deployment can be reproduced from the repository docs.

## Explicit non-goals

- No relocation of Roon Server from CALLISTO.
- No duplication of Roon's catalog, playback engine, zone state or transport implementation.
- No assumption that Linux Docker can run macOS Swift/CoreAudio capture directly.
- No fake/simulated audio data presented as live measurements.
- No changes to the current working playback chain during backlog creation.

## Recommended work order

P0.1 → P0.2/P0.3/P0.4 → P0.5 → P1.1/P1.2/P1.3 → P2.1/P2.2/P2.3/P2.4 → P2.5 → P3.

**Release gate:** cold boot MIMAS without login → TOPPING DX5 appears in Roon on TRITON → audio plays → true capture data drives the browser UI hosted on CALLISTO.
