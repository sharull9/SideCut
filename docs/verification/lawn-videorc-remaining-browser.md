# Remaining phase browser verification

Verified on Windows on 2026-11-03 against the current checkout. This audit covers all 25 phases marked in progress in [the phase checklist](../lawn-videorc-phases.md). No phase was promoted to complete: the remaining physical, native, hosted and provider requirements cannot be established by a local browser run.

## Browser results

The current production web build passed. Restored missing dependencies with `vp install --frozen-lockfile` before verification; package versions and the lockfile were unchanged.

| Journey                          | Result and evidence                                                                                                                                                                                               |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chromium recording               | Passed camera, microphone, synthetic screen, import/place/reload, decoded export, completed recovery and interrupted-prefix recovery. [Result](lawn-videorc-capture-runtime.json).                                |
| Firefox recording                | Passed camera, microphone, synthetic screen, import/place/reload, decoded export and recovery. [Result](lawn-videorc-capture-firefox.json).                                                                       |
| Studio UI                        | Passed scene switching, camera/screen, microphone meter/mute, decoded 1080p recording with audio, editor import, recent clips, unsaved-output guard and scene reload. [Result](lawn-videorc-studio-ui.json).      |
| Scene compositor                 | Passed revision handling, preview pixels and decoded scene switches. [Result](lawn-videorc-scene-switch.json).                                                                                                    |
| Live assets/audio                | Passed styles, overlays, reduced motion, audio graph and decoded synthetic A/V checks. Measured offset was 82.2 ms for a configured 100 ms delay. [Result](lawn-videorc-assets-audio.json).                       |
| Recent clips                     | Passed decoded multi-segment video/audio, source changes, marks and retention checks. [Result](lawn-videorc-recent-clips.json).                                                                                   |
| Chat/captions/appearance         | Passed decoded highlight/removal, caption output-target isolation and companion activation/teardown fixtures. [Result](lawn-videorc-live-engagement.json).                                                        |
| General Chromium/Firefox journey | Passed import/edit/reopen, read-only keyboard behavior, audio, WebM/WAV export and archive reopening. [Results](phase-136-browsers.json).                                                                         |
| General WebKit journey           | Failed before editing: SQLite/OPFS storage could not open. WebCodecs and AudioBuffer were unavailable in this Windows WebKit runner. This does not establish Safari behavior. [Results](phase-136-browsers.json). |

Commands: `vp run build:web`, `vp run verify:recording`, the same command with `SIDECUT_RECORDING_ENGINE=firefox`, `vp run verify:studio-ui`, `vp run verify:live-studio`, `vp run verify:live-assets-audio`, `vp run verify:recent-clips`, `vp run verify:live-engagement`, and `vp run verify:browsers`. The last command exits 1 because WebKit fails; the other listed journeys pass.

## Shared browser checks

At localhost:3000, Teams opened/reopened and fit a 390-pixel viewport: dialog left 16, width 358, document width 390. The current environment is unconfigured, so hosted authentication and mutations were unavailable. Studio was checked in an isolated incognito profile: saving and switching a scene rendered a 1920×1080 program with center pixel `[17,24,39,255]`. Saving a banner kept it off air; switching changed its sampled pixel to `[56,189,248,255]`. Camera access displayed `Permission denied` without losing the scene. The synthetic production script supplies separate successful media-device evidence.

The local cloud-library fixture at localhost:4317 uses the real LibraryBrowser and Convex test handlers, not hosted data. Checked pagination with selection retained, folder creation, move into a new folder and filtering, archive, restore, and an injected failed update followed by successful retry. The failure retained `Select Camera test`. Viewer mode exposed zero file-selection inputs and zero write buttons; prefix `inter` found Interview final. At 390 pixels the viewer document width was 390. These results do not establish hosted pagination or R2 access.

Some preview CSS selectors and refs timed out during reloads and viewport changes. Fresh snapshots and current refs resolved the successful fixture interactions. The preview later repeatedly failed to capture dashboard snapshots with `Preview automation snapshot timed out after 15000ms`; dashboard screenshots and acceptance use local Playwright instead.

## Remaining acceptance by phase

| Phase | Browser result                                                               | Still required                                                                                                       |
| ----- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| LV003 | Production Chromium/Firefox capture and recovery pass.                       | Actual OS screen picker and physical camera acceptance.                                                              |
| LV005 | Native feasibility has no browser acceptance path.                           | Physical A/V calibration, sustained capture and resource measurements.                                               |
| LV012 | Unconfigured dialog and dashboard states pass.                               | Configured hosted sign-in, team mutations, signed verified-email invitations, desktop OAuth and deployment settings. |
| LV013 | Local library fixture passes the operations above.                           | Upload UI, cancellation/quotas/cleanup, thumbnails, processing, deployed pagination and live private R2.             |
| LV014 | Hosted playback is unavailable in the dashboard.                             | Processing service, playable objects, thumbnails and authorized R2 delivery.                                         |
| LV015 | Guest review controls/page remain unavailable.                               | Guest UI, hosted identity/object delivery and retention/abuse acceptance.                                            |
| LV016 | Scene preview, decoded recording and Studio UI pass.                         | Native recorder integration and real devices.                                                                        |
| LV017 | Browser styles, overlays and controls pass.                                  | Native acceptance.                                                                                                   |
| LV018 | Browser audio graph, controls and synthetic timing pass.                     | Physical calibration, richer cleanup and native routing.                                                             |
| LV019 | Browser buffer clips and editor handoff pass.                                | Gapless native capture, crash recovery of unsaved takes and timeline-marker handoff.                                 |
| LV020 | Studio has no destination controls or native compositor routing.             | Studio routing, production UI/devices and provider interoperability.                                                 |
| LV021 | Multistream controls are absent.                                             | Independent target stop, reliable delivery/recovery health and studio UI.                                            |
| LV022 | Dual-output controls are absent.                                             | Browser output wiring, separate encoders and simultaneous decoded acceptance.                                        |
| LV023 | Dashboard explicitly marks connected accounts unavailable.                   | Provider OAuth/storage/adapters, scheduling/thumbnails and live accounts.                                            |
| LV024 | Decoded chat-highlight fixture passes; controls remain absent.               | Provider transports, moderation, emote assets and studio UI.                                                         |
| LV025 | Decoded caption target-isolation fixture passes; controls remain absent.     | Speech transport, physical latency/reconnection and native routing.                                                  |
| LV026 | Decoded companion appearance fixture passes; controls remain absent.         | Onboarding/library controls, licensed imported assets and native acceptance.                                         |
| LV027 | No browser behavior/posting controls.                                        | Provider posting, AI answers, automation and production UI/acceptance.                                               |
| LV028 | Dashboard marks derived edits unavailable.                                   | Job/project controls, durable orchestration and rendered quality acceptance.                                         |
| LV029 | Dashboard marks hosted AI/publishing unavailable.                            | External AI, downloads, deployment, media verification and retention.                                                |
| LV030 | Dashboard marks billing/usage/account operations unavailable.                | Payments/signed webhooks, billing, functional controls, purge scheduling and hosted acceptance.                      |
| LV031 | Browser Studio has manual scene/recording controls; automation UI is absent. | Automated start/permissions, active compositor integration and production automation acceptance.                     |
| LV032 | Phone/pairing/deck UI is absent.                                             | Trusted LAN certificates, persistence/discovery, shortcut controls and real hardware.                                |
| LV034 | Browser checks do not verify native packages or devices.                     | Native macOS, Linux device adapters, physical calibration and real desktop acceptance.                               |
| LV035 | Browser checks do not verify signing, installation or recovery.              | Signing/updates, broader migrations/recovery, native platform acceptance and certification.                          |

## Cloud dashboard

Added `/cloud` with URL-backed Overview, Library, Team, Reviews, Publishing and Usage navigation, an editor entry link and a return link. Team and Library reuse the existing lazy-loaded WorkOS/Convex components and authorization. The existing Teams dialog remains supported. Reviews, publishing and usage display explicit availability limits rather than simulated jobs, statistics or actions. Configuration status indicates build configuration, not authenticated connection health.

Run `vp run verify:cloud-dashboard` after a web build. [Machine result](lawn-videorc-cloud-dashboard.json), [desktop screenshot](lawn-videorc-cloud-dashboard-desktop.png) and [phone screenshot](lawn-videorc-cloud-dashboard-mobile.png) record navigation, URL fallback, history, keyboard skip, responsive bounds, accessibility and editor return. Configured account/library behavior requires separate hosted acceptance.

The initial full workspace check passed formatting, lint and types, with 728 tests passing and one desktop CLI test exceeding its 5-second timeout. All seven tests in that file passed when rerun alone. The final `vp run check` passed all 20 tasks, including formatting, lint, typechecking and all 729 tests across 150 files. Dashboard production acceptance passed with no page errors, no serious/critical axe findings and no overflow at 1440, 768, 390 or 320 pixels. Exact logs are local under `logs/lv-browser-*`.
