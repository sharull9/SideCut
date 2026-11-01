# Remaining phase implementation

The user explicitly requested implementation and verification of the remaining work on 2026-11-01. Checklist labels must follow acceptance evidence. The starting point is 10 done and 25 in-progress phases, with 727 passing local tests. The latest branding build has Windows packaged/installed acceptance; Linux SQLite acceptance comes from the earlier snapshot.

## Delivery order and completion gates

| Unit                   | Phases              | Remaining acceptance predicate                                                                                                                                                                 |
| ---------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cloud account          | LV012               | Browser OAuth returns to the app, signed-in team/invitation flows enforce verified claims, desktop OAuth works, and configured hosting is exercised.                                           |
| Library and uploads    | LV013               | Users browse/search/folder/select/archive/restore media and upload files with progress, retry, cancellation, quotas and cleanup; real private object delivery and access refusal are verified. |
| Hosted versions        | LV014               | A trusted processor verifies actual media, publishes playable versions/thumbnails, and preserves prior-ready playback through failure/retry.                                                   |
| Guest review           | LV015               | Guest pages open scoped grants, handle passwords/private identity, play actual objects and exercise comments/replies/presence/workflow and revocation.                                         |
| Studio controls        | LV016–LV019         | Production controls drive saved scenes, sources, assets, audio and recent clips; preview/recorded output and editor handoff agree through recovery.                                            |
| Streaming              | LV020–LV023         | Composed output reaches destinations with sound/timing controls, independent targets/renditions and securely stored provider account lifecycles.                                               |
| Audience and captions  | LV024–LV025         | Real transports feed chat/captions, moderation and routing controls, with reconnect, consent and latency acceptance.                                                                           |
| Companion and edits    | LV026–LV028         | Appearance/behavior/job controls connect existing models to reviewed actions, licensed assets and verified rendered outputs.                                                                   |
| Hosted AI and accounts | LV029–LV030         | Hosted workers deliver real outputs with consent/retention/account controls, provider/payment integration and enforced usage/storage accounting.                                               |
| Automation and remote  | LV031–LV032         | Production studio controls integrate automation; pairing/control pages, certificates/persistence and physical phone/deck checks pass.                                                          |
| Capture/platforms      | LV003, LV005, LV034 | Actual browser pickers/devices, physical A/V calibration and sustained resource measurements, Linux device adapters and native macOS checks pass.                                              |
| Release                | LV035               | General settings/library migrations, broader abandoned-file recovery, signing, authenticated updates/rollback and full workflow acceptance pass.                                               |

This order follows the existing plan and service boundaries: local editing remains independent of cloud identity; browser controls call the typed cloud API; storage credentials and authoritative upload acknowledgements stay on the server. No phase is completed by substituting a stub, marking unverified output ready or suppressing a failing check.

## Verification workflow

For each unit, add a regression or integration fixture at its real boundary, implement the smallest complete behavior, run focused tests, exercise the running UI when affected, and record the result here and in its phase report. Run broader workspace/build checks after each cohesive group. Use existing fake devices/local receivers for repeatable checks and identify external account/hardware checks separately. Do not promote an entire phase while its required workflows remain unverified.

Missing access to a provider, physical device or platform is an external acceptance dependency. It does not prevent implementing and testing independent local work. Current documentation records no configured R2 bucket or hosted media processor; provider-account and payment acceptance are also outstanding. Credentials must be supplied through secret handling rather than committed files or chat.

## Work log

| Date       | Unit                                 | Evidence                                                                                                                                          | Result                                                                                                                                                                                            |
| ---------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-11-01 | Baseline audit                       | Existing phase checklist, cloud/streaming/remote reports and source boundaries                                                                    | 25 phases require substantive implementation or external acceptance; status labels retained.                                                                                                      |
| 2026-11-01 | Library UI and indexing              | [Browser and automated acceptance](lawn-videorc-library-browser.md); 728 tests, lint, typechecks, web build                                       | Metadata controls and indexed cursor browsing/search implemented; owner/viewer browser journeys verified locally. Upload lifecycle and hosted acceptance remain open; LV013 retained in progress. |
| 2026-11-01 | Studio controls and Teams connection | [Studio acceptance](lawn-videorc-studio-ui.md); 729 tests, lint, typechecks, web build; preview browser session against hosted development Convex | Studio dialog shipped with production synthetic-device checks. Teams now connects while signed in. No phase promoted: native, physical and hosted requirements remain open.                       |
