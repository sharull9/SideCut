# Lawn and Videorc feature parity plan

Updated: 2026-10-26 after fetching and fast-forwarding to SideCut `origin/main`. Implementation is authorized and starts with the [executable phases](lawn-videorc-phases.md). Later cloud/native choices remain subject to their recorded feasibility and service decisions.

## Objective

Extend SideCut to cover the user-facing features of both Lawn and Videorc, while retaining the existing browser editor and optional Electron desktop application. The user explicitly selected full parity with both repositories. Recording and review are early milestones, not a reduced final scope.

The intended workflow is: capture or go live, retain editable recordings, edit in SideCut, prepare outputs, publish a review version, collect feedback, and deliver the revision. Local editing and recording must remain usable without a cloud account. Cloud sharing, platform accounts, and hosted AI require their respective services.

Parity means equivalent supported workflows, including failure handling and platform limits. It does not mean duplicating brands, pricing, internal transports, or unsupported upstream claims. Use a capability matrix per OS and provider; distinguish implemented, locally tested, externally tested, and blocked. Keep backend work for hosted features in scope even when the supplied repositories expose only a client contract.

## Inspection baseline

SideCut was fetched with `git fetch origin main`. This branch was 17 commits behind with no divergent commits, so `git merge --ff-only origin/main` updated it while preserving this untracked plan. Both cached reference repositories were refreshed with `git pull --ff-only` in `C:/Users/Arafa/.explore/repos`.

| Repository                                                                                    | Inspected revision                         | Role                                                            |
| --------------------------------------------------------------------------------------------- | ------------------------------------------ | --------------------------------------------------------------- |
| [SideCut](https://github.com/sharull9/SideCut/tree/34dc3d8e0abef7bcb8bdfd690b42b731001cffb7)  | `34dc3d8e0abef7bcb8bdfd690b42b731001cffb7` | Updated worktree; draft plan preserved                          |
| [Lawn](https://github.com/pingdotgg/lawn/tree/9163eac92bbc5c4cd24eec83f63541ce20f17477)       | `9163eac92bbc5c4cd24eec83f63541ce20f17477` | Cloud video library and team review                             |
| [Videorc](https://github.com/TheOrcDev/videorc/tree/3bfd86f25bb41c6538295c7c08cc8d9a711680a4) | `3bfd86f25bb41c6538295c7c08cc8d9a711680a4` | Desktop recording, live production, streaming, and AI workflows |

This is a source and documentation survey, not a runtime certification of either external product. Feature families below need individual behavior fixtures during implementation; file presence alone is not proof that a platform feature works.

### What changed since the first plan

The first draft used SideCut `8d6a720` and Videorc `67c12b8`. The refreshed code removes several proposed prerequisites:

- Portable archives, relink services, EDL and expanded Filmora import already exist. Extend their limits and integrate recording outputs rather than implementing them again.
- Browser persistence now uses SQLite WASM and OPFS. Desktop projects, resources and preferences use profile-local SQLite with separate media files. Reuse the migrations and repository interfaces.
- Authenticated local HTTP, change events, CLI, MCP, the `@sidecut/client` SDK, and headless hosting already exist. Phone control needs a restricted protocol, but the editor does not need a second general-purpose local service.
- The editor now has comments/to-do search and resolution, history/activity and durable agent-review controls. These are local project workflows, not Lawn's version-bound remote threads. Resolving a project comment currently removes its marker.
- Desktop service exports already produce H.264/AAC MP4 and 4K HEVC. UI downloads remain WebM/WAV. Existing 4K and five-minute synthetic export evidence does not establish long-form capture or a native live compositor.
- Windows packaging and a Debian container install journey have recorded evidence. Native macOS, real Linux desktop/capture and upstream visual/audio comparisons remain separate gaps.
- Videorc added 30/60-second recent clips, ten live backgrounds, built-in greetings, revised studio/meter controls and source-recording recovery fixes. Include these in the refreshed parity target.

The revised first implementation slice is a capture-to-edit workflow using existing storage, project import and job services. Archive/relink implementation and agent transport are no longer entry prerequisites. Longer recording/export and cloud review remain major new workstreams.

### Evidence to use during implementation

Lawn paths below are relative to its pinned revision:

- `convex/schema.ts`: teams, role-based membership, invitations, nested folders, video versions, workflow status, timestamped comment threads, share links and access grants.
- `convex/comments.ts`, `shareAccess.ts`, `shareLinks.ts`, `security.ts`: authenticated/public review boundaries, replies and resolution, scoped access.
- `convex/s3Multipart.ts`, `s3.ts`, `muxActions.ts`, `mux.ts`, `crons.ts`: upload, processing and cleanup lifecycle.
- `convex/search.ts`, `searchEntries.ts`, `functions.ts`: team-scoped search and index maintenance.
- `convex/videoPresence.ts`, `src/components/presence/VideoWatchers.tsx`: review presence.
- `src/components/video-player/VideoPlayer.tsx`, `shuttle.ts`, `VideoEditorLayout.tsx`: player controls, frame stepping, shuttle and theater layout.
- `src/lib/commentCsv.ts`, `commentLinks.ts`, `videoSelection.ts`, `useBulkVideoActions.ts`: comment export, linked text and bulk library actions.
- `app/routes/dashboard/`, `app/routes/-watch.tsx`, `app/routes/-share.tsx`: library, account/team management, and public viewing.

Videorc paths below are relative to its pinned revision:

- `crates/videorc-backend/src/protocol.rs`: runtime request/event models, quality settings, scenes and dual-orientation outputs.
- `screen_capture.rs`, `camera_capture.rs`, `system_audio_capture*.rs`, `linux_*`, `windows_*`: platform capture and encoding paths with different maturity levels.
- `scene.rs`, `live_scene.rs`, `live_pipeline.rs`, `compositor.rs`, `recording*.rs`, `streaming.rs`, `source_iso.rs`: live production and output ownership.
- `docs/banners.md`, `live-backgrounds.md`, `soundboard.md`, `overlays.md`: live assets, layers, audio pads and overlays.
- `docs/replay-buffer.md`, `session-markers.md`, `remote-control.md`: recent-clip retention, markers, local controls and paired phone remote.
- `apps/desktop/src/shared/clip-lengths.ts`, `protocol-fixtures/buddy-builtin-greetings.json`, `docs/live-backgrounds.md`: 30/60-second clip contract, default greeting behavior and ten animated background styles. `docs/releases/0.12.0.md` records upstream release claims and Windows/Linux physical-acceptance waivers; these are not SideCut acceptance evidence.
- `youtube.rs`, `youtube_quota.rs`, `twitch*.rs`, `kick*.rs`, `x_*.rs`, `scheduled_*.rs`: provider lifecycle, chat, quotas and scheduled broadcasts.
- `docs/buddy.md`, `buddy-commands*.md`, `clean-cut*.md`, `captions.rs`, `videorc_api.rs`: AI companion, speech and post-recording service contracts.
- `apps/desktop/src/main/obs-import.ts`, renderer `components/tabs/`, and `docs/distribution.md`: import, product surfaces and release behavior.

The public README and remote raw-file responses can lag the checked-out source. The local pinned revisions above govern this plan.

## What SideCut already supplies

The current code is substantially beyond the original scaffold described at the top of `docs/monorepo-plan.md`. Some README paragraphs also retain obsolete statements. Prefer current source and the latest verification reports below.

- `packages/contracts/src/project.ts` and `commands.ts` define validated projects and editing commands.
- `packages/core/src/coordinator.ts` owns deterministic edits, revisions, idempotency and undo/redo. `markers.ts` already implements local comments; they are project markers, not multi-user review threads.
- `packages/core/src/transcript.ts`, `short.ts`, and `formats.ts` already support transcript-based editing and portrait proposals. Existing captions, noise isolation, transforms, effects, titles, and assets should be extended rather than replaced.
- `packages/platform-browser/src/` owns SQLite WASM/OPFS persistence, media decoding, preview, audio, export, derived caches and background jobs. Desktop SQLite storage is implemented in `apps/desktop/src/main/sqlite-storage.ts` and `project-store.ts`.
- `apps/web/src/modules/workspace/browser-session.ts`, `editor-session.tsx`, and `host-coordinator.ts` connect the editor to its authority. New features should not turn `browser-session.ts` into a cloud/studio monolith.
- `apps/desktop/src/main/project-service.ts`, `project-store.ts`, `native-media.ts`, and `native-ipc.ts` provide host project authority, durable save behavior and bounded FFmpeg/FFprobe work. `src/preload/preload.ts` and `src/shared/bridge.ts` expose the narrow desktop boundary.
- `apps/desktop/src/main/service-archive.ts`, `service-relink.ts` and `filmora-import.ts` implement resource consolidation, portable copies/relinking and interchange. Reuse the existing browser archive path too.
- `apps/desktop/src/main/project-api.ts`, `http-service.ts`, `renderer-service.ts`, `packages/client`, and `scripts/sidecut-cli.mjs`/`sidecut-mcp.mjs` supply local service access, change events and automation. `main.ts` already supports headless project hosting with leases. Some media operations still depend on the renderer service.
- `apps/web/src/modules/workspace/comments-panel.tsx`, `history-panel.tsx`, and `keyboard.ts` implement current local review/navigation controls. Reuse the controls without treating marker deletion as persistent thread resolution.
- `packages/core/src/service-export.ts` and existing native encoding supply shared sizing/preset logic, H.264/HEVC service exports and WAV/WebM output.

Current limits matter: export ranges retain a five-minute bound and output/resource paths have 256 MiB limits. The UI queue is in memory and holds at most five entries. Browser exports support up to 16 million pixels at 1–60 fps. Timeline composition still runs through the shared browser renderer, followed by native encoding for service MP4 outputs. Sustained recording, live native composition, streaming and hosted review remain absent.

Use these current reports as historical evidence, not checks run by this planning task:

- `docs/verification/continuation-2026-10-25-followup.md`: the 2026-10-26 checkpoint records lint, TypeScript and 521 tests in 109 files, fixed Firefox hydration, Chromium/Firefox journeys and refreshed Windows package checks.
- `docs/verification/export-presets.md` and `export-stress.md`: full-resolution UI WebM, native service MP4/HEVC, marked ranges, five minutes at 320x180 and thirty seconds at 4K. Stress fixtures are synthetic and do not prove complex edits at that duration/resolution.
- `docs/verification/sqlite-migration.md`, `jobs-archive.md`, `render-review.md`, `mcp-adapters.md`, and `sdk.md`: persistence, archives, local review/query and automation behavior.
- `docs/verification/linux-container.md`: Debian packaging/install/reopen in an isolated container. This does not prove capture, Wayland, physical devices or a user's Linux desktop. WebKit is blocked by storage/media prerequisites on the tested host; native Safari and public hosting remain unverified.

## Feature inventory and destination

“Partial” means useful existing primitives, not completed parity. References are the pinned files listed above.

| Feature family                                                                                   | Upstream | SideCut baseline                                                         | Planned destination / milestone                                      |
| ------------------------------------------------------------------------------------------------ | -------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| Teams, invitations, roles, team switching                                                        | Lawn     | Missing remote workspace                                                 | Cloud workspace, M5                                                  |
| Nested folders, sorting, selection, move/delete, search palette                                  | Lawn     | Local media bin and asset search only                                    | Cloud library, M5                                                    |
| Resumable upload, original download, thumbnails, processing status, failed-upload recovery       | Lawn     | Local media import/jobs                                                  | Cloud ingestion, M5                                                  |
| Video versions, version browsing policy, review/rework/done                                      | Lawn     | Project revisions and durable review baseline, no hosted review versions | Immutable review assets, M6                                          |
| Timestamped threads, replies, resolution, open/resolved filters, comment links                   | Lawn     | Searchable local comments/to-do panel; resolution removes a marker       | Persistent version-bound review model, M4/M6                         |
| CSV comment export for editorial handoff                                                         | Lawn     | Missing equivalent                                                       | Review export, M4                                                    |
| Share links, expiry, password access, download control, public/private viewing, views            | Lawn     | Local project interchange only                                           | Hosted viewer and grants, M6                                         |
| Watcher presence and live comment updates                                                        | Lawn     | Same-host editor authority only                                          | Review subscriptions, M6                                             |
| Review player, frame step, J/K/L shuttle, rate and theater controls                              | Lawn     | Editor navigation, expanded keyboard controls and transport              | Audit/reuse controls; add review-specific gaps, M4                   |
| Billing, subscriptions, storage limits, account/team settings                                    | Lawn     | Missing hosted product                                                   | Optional paid-service layer, M10                                     |
| Screen/window, camera, microphone, system audio; permission/device recovery                      | Videorc  | Media files only                                                         | Browser capture M2; native capture M3                                |
| Scene presets/saved scenes, PiP, masks, snapping, transforms, scene switching                    | Videorc  | Offline transform/PiP primitives                                         | Studio scene model and compositor, M3/M7                             |
| Static backgrounds, ten live styles with saved looks/motion, banners, takeovers, chat highlights | Videorc  | Offline assets/effects partially overlap                                 | Studio assets and scene layers, M7                                   |
| Input meters, gain/mute, monitoring, sync offset, soundboard, live cleanup                       | Videorc  | Offline mixing/cleanup and meters                                        | Live mixer, M3/M7                                                    |
| Recording library, import/reveal/delete, posters, timeline/markers and transcripts               | Videorc  | SQLite resources/projects, archives/relink and editorial queries         | Recording metadata and editor import, M3                             |
| Long recording, MKV recovery/MP4 remux, quality profiles, hardware encode                        | Videorc  | H.264/HEVC/WebM service exports; no live recording                       | Sustained output engine and larger-file path, M3                     |
| Separate source recordings and shared timing                                                     | Videorc  | Synced role/take placement primitives                                    | Native isolated tracks and import, M3/M7                             |
| Always-available recent clips at 30/60 seconds, clip marks, spoken commands, suggested moments   | Videorc  | Markers/short proposals partially overlap                                | Runtime buffer M7; AI analysis M9                                    |
| RTMP/RTMPS, record+stream, multistream, per-target health/retry                                  | Videorc  | Missing                                                                  | Native output graph, M8                                              |
| Horizontal/vertical simultaneous output, per-provider quality                                    | Videorc  | Offline portrait layouts only                                            | Multiple live compositions, M8                                       |
| YouTube/Twitch/Kick/X account connection, metadata and broadcast lifecycle                       | Videorc  | Missing                                                                  | Provider adapters, M8                                                |
| TikTok/Instagram/other RTMP destinations                                                         | Videorc  | Missing                                                                  | Custom RTMP where platform permits, M8; no implied native OAuth/chat |
| Scheduled streams, thumbnails, audience/viewer stats, unified chat/emotes, moderation            | Videorc  | Missing                                                                  | Provider-specific capabilities, M8/M9                                |
| Live captions with independent preview/record/stream burn-in                                     | Videorc  | Offline transcription/captions                                           | Streaming speech plus live rendering, M9                             |
| AI companion profile/library, still/animated avatars, overlay reactions and onboarding           | Videorc  | Asset library only                                                       | Companion model and assets, M9                                       |
| Questions, draft answers, flags, promises, built-in/custom greetings, banter, commands, reports  | Videorc  | Missing live producer                                                    | Explicitly controlled AI producer, M9                                |
| Clean/condensed cuts, noise-cleaned derivatives, retained originals and retimed SRT              | Videorc  | Local tightening, cleanup and captions partially overlap                 | Derived-project jobs, M9                                             |
| Publish-pack/transcript/AI account contracts                                                     | Videorc  | Partial local editorial tools                                            | SideCut-hosted equivalent where contracts exist, M9/M10              |
| Local hotkeys/deck controls, phone pairing/revocation and reduced remote view                    | Videorc  | Expanded shortcuts, authenticated HTTP, CLI/MCP/SDK, headless hosting    | Restricted studio/remote actions, M11                                |
| OBS settings/scene import                                                                        | Videorc  | EDL and expanded Filmora import; no OBS scene importer                   | Reuse import diagnostics and asset handling, M11                     |
| Health diagnostics, repair, support bundles, updates, signing, consent/settings                  | Videorc  | Jobs/diagnostics; Windows packaging and Debian container evidence        | Capture/release hardening and remaining platforms, M12               |

For publish packs, separate generated metadata/assets from actually uploading a video to a social network. The desktop contains hosted-service capability contracts; these do not establish that every advertised publishing workflow is fully implemented in the supplied repository. A hosted web service is referenced outside this inspection. Specify each output and obtain a fixture before claiming parity. Direct social upload beyond verified upstream behavior is an extension, not an assumed requirement.

## Architecture recommendation

### Alternatives

1. **Merge/fork the external applications.** Fast access to working code, but creates competing schemas, Electron hosts, UI systems, build tools and product authorities. Videorc reuse also requires a deliberate license decision. This has the highest long-term integration cost.
2. **Build everything in the browser.** Keeps one runtime but cannot establish the required native capture, sustained recording and direct streaming parity. A remote relay would add its own backend and privacy/cost tradeoffs.
3. **Extend SideCut with native studio services and an optional cloud service. Recommended.** Retain portable edit semantics and one React UI, add native media only where required, and isolate cloud review from local projects.

### Runtime boundaries

Keep `apps/web` as the shared product UI, with feature modules for workspace, studio, recordings, review, cloud library, and settings. Preserve the existing design tokens and owned UI components. Add packages only when their first consumer requires a real boundary:

- `packages/contracts`: portable Effect schemas for capture sessions, capabilities, scenes, review versions, comments, jobs, and provider states. Keep secrets and live native handles out of serialized project files.
- `packages/core`: deterministic edit commands, scene geometry shared with offline layouts, transcript mapping, and conversion of capture/review artifacts into undoable edits.
- `packages/platform-browser`: browser recording adapter and existing local media implementation. Browser capture advertises only detected capabilities.
- `apps/desktop/src/main`: reuse the current host authority, SQLite repository, `ProjectAPI`, renderer service, local HTTP/discovery, leases, credentials and process lifecycle. Add capture-specific device/permission operations. The current Electron session denies all permission requests; replace that only with validated, user-initiated capture permission handling, not a blanket allow.
- A native capture worker only after the M1 prototype demonstrates the required boundary. A Rust `crates/sidecut-media` worker is a candidate for sustained capture/GPU work, not a prerequisite already decided by this plan. Reuse existing FFmpeg encoding and project storage, and add native composition where measured capture/streaming needs justify it.
- New `apps/cloud` and a cloud client module when M5 begins: authentication, tenants, review metadata, uploads, subscriptions, delivery authorization, webhook processing and service jobs. Keep the provider SDKs here rather than in portable core.

The existing native five-minute FFmpeg job runner is suitable for bounded conversions; do not stretch it into a streaming session by increasing timeouts. Sustained sessions need independent health, lifecycle, output recovery, buffering and cancellation.

Use the existing authenticated local service for editor/automation clients. Keep any capture worker protocol private to the host, with bounded queues and explicit ownership. Phone remotes need a restricted authenticated listener and reduced events; never expose the existing general-purpose project service or its credential to the LAN. Headless editing is already present and does not establish headless capture permissions or native-device readiness.

### Distinct models and clocks

- An editable `Project` stays under the existing coordinator and journal.
- A `CaptureSession` owns selected devices, monotonic timing, source tracks, scene events, output files and recovery metadata. Persist it independently of editor history.
- A `ReviewAsset` owns an ordered collection of immutable `ReviewVersion` records. Each version binds an exported file, project ID/revision, duration, frame rate and export range/time mapping.
- A `ReviewThread` belongs to a specific review version and time/range, with author, replies and resolution. Review changes must not mutate a shared timeline or enter editor undo history.
- A `Destination` separates platform identity, public settings and an opaque credential reference. A `StreamSession` tracks each output independently.
- A `DerivedEditJob` retains source identity, proposed cuts, user choices, output and provenance. AI proposes existing commands; the coordinator validates and applies a batch.

Use a common monotonic session clock for video, audio and scene events. Bridge it explicitly to project ticks and export time. Source recordings should import with their offsets intact, not only as a flattened composite. Decide the policies for device loss, sleep and discontinuities before encoding.

Review feedback stays pinned to its original rendered version. “Create timeline marker” is an explicit editor action, validated against the source revision and time mapping. Later edits must not silently shift old review feedback onto unrelated frames. Review subscriptions are not collaborative timeline editing.

### Cloud proposal

Use Convex for the first cloud metadata/subscription implementation, an auth integration that supplies server-verified identity, S3-compatible object storage for originals, and Mux for hosted playback/transcoding. This follows Lawn's working separation while keeping provider choices behind cloud APIs. The auth vendor, regions, retention, budget and playback costs remain decisions for M5; no accounts or paid resources are needed to accept this plan.

Use resumable multipart uploads, retry-safe finalize operations and webhook deduplication. A version is publishable only after its bytes and processing status are verified. Keep the prior ready version available during replacement. Enforce tenant access and scoped viewer grants on metadata, comments, downloads and playback authorization. Test the generated media URLs, not just the viewer route. Revoked grants stop new authorization; document the maximum lifetime of already-issued URLs.

Cloud review is optional in the UI; editing and recording continue locally when it is unavailable. Upload only user-selected rendered versions/originals. Hosted AI requires separate, revocable consent for the data it sends. Build our own service integration; do not make SideCut depend on undocumented Videorc production endpoints.

## Milestones and acceptance

The milestones are workstreams, not replacements for the existing numbered Tandem phases. Each must be divided into small changes with a source fixture, failure cases, verification result and updated capability entry.

### M0 — Freeze the parity inventory and baseline

Create a machine-readable capability inventory linked to both pinned revisions. For every family above, list its UI actions, persistence, network/native dependencies, platforms and acceptance evidence. Classify externally dependent and incomplete upstream behavior. Run `vp run check`, `vp run build`, and `vp run build:desktop`; retain actual results rather than copying the previous verification report.

Accept when every inventory row maps to an implementation milestone or a named upstream/service limitation. A moving upstream main branch must not silently expand the release target.

### M1 — Storage and native feasibility

Reuse the completed archive/relink and SQLite work. Check its fit for growing recordings: file-backed streaming writes, resource registration after finalization, chosen output directories, disk-full recovery and files beyond 256 MiB. Add recording metadata to the existing desktop repository; do not create a parallel project database. Retain browser/desktop adapter boundaries and migration tests.

Prototype native screen+microphone capture and inspect recorded output on the target OS. Measure capture/preview latency, A/V drift, encode throughput, dropped frames, memory and disk growth at 1080p30, then higher profiles. Compare a minimal host-managed implementation with the proposed native worker. Record the result and choose the engine boundary before investing in all platform backends.

Accept when a capture artifact survives restart, relink and editor import through existing storage, and the chosen engine has measured evidence and a documented failure/recovery model. Publish the larger-file storage contract. Long recording and long editor export require separate evidence.

### M2 — Browser recording

Add screen/window selection through browser display capture, camera/microphone capture, explicit permissions, a recording state machine, countdown, stop/cancel and chunk persistence in the existing OPFS resource path. Register finalized outputs through the current import/session operations and reuse existing jobs. Support source combinations only when the browser can actually provide them; system audio and compositing require explicit capability reporting.

Accept when a synthetic recording saves, reopens, edits and exports within the current editor limits. Test denied permission, source-ended, missing device, storage exhaustion and cancellation. Browser coverage does not count as native studio parity.

### M3 — Native recorder and recording library

Implement the capture boundary selected in M1, including worker supervision/protocol if a worker is needed, native device selection, system audio, live mixer and preview. Add sustained recording, MKV finalization/recovery and MP4 remux, configurable profiles, output directory, posters, library operations, and source-isolated recordings with timing metadata. Make “Edit in SideCut” create a project referencing the retained sources and offsets.

Add platform backends separately: Windows first for this environment, then macOS and Linux with their actual permission/capture/encoder paths. Add hardware encoding and a documented fallback. Extend the existing H.264/HEVC render path and file-backed outputs beyond five-minute/256-MiB limits. Native 4K encode already exists; remaining work is sustained throughput, complex long-form rendering and durable output jobs. Preserve preview/export semantics and existing preset validation.

Accept each OS/profile only with real artifact inspection, duration/frame cadence, color metadata, audible/correctly timed tracks, restart recovery, interrupted finalization, device loss and bounded resources. Include a long-duration run before claiming long recording or 4K parity. Test at least a 60-minute session for the long-form target; record hardware and measured budgets.

### M4 — Local review foundation

Audit the existing keyboard/transport and comments panel against Lawn's review player, reusing frame navigation and comment seeking. Add only missing shuttle/rate/theater behavior. Add an immutable local review-version record and persistent threads/replies/resolution, distinct from local marker deletion and the agent-reviewed revision baseline. Add CSV export with formula-safe cells, linked text and explicit import-to-marker actions. Preserve existing local comment behavior and provide explicit conversion rather than silently migrating editable timeline markers into remote threads.

Accept when comments stay on the same review frame after later timeline edits, switching review versions selects the correct threads, exports round-trip safely, and a local review session survives reload. Browser/editor transport behavior must remain consistent.

### M5 — Cloud workspace and ingestion

Implement authenticated tenants, invitations, owner/admin/member/viewer rules, team switching, folders, sorting/search, multi-selection and bulk actions. Add resumable upload, processing jobs, local-first thumbnails, upload recovery, original-file download and storage accounting.

Accept with two distinct tenants and role fixtures: no cross-tenant read/write or media delivery, resumable transfer after interruption, duplicate finalization/webhooks, failed processing recovery, safe deletes and clear offline behavior. Verify against test services before enabling paid production processing.

### M6 — Hosted review parity

Connect M4 to immutable uploaded versions. Add public/private viewing, version browsing settings, password/expiring/revocable share grants, download permissions, view counting, team/public feedback policies, live updates and watcher presence. Add review/rework/done workflow and editor handoff.

Accept when authorized guests can perform the exact allowed review actions, a revoked/expired link cannot obtain fresh media authorization, disabling download affects original delivery, and old comments remain bound to old versions. Test concurrent replies, retry deduplication, status changes, private-version exposure and stale share access.

### M7 — Full production studio

Add saved scenes, live scene switching, snapping/transforms/masks, static backgrounds and ten animated style equivalents with saved looks/motion, banners, takeovers, overlay positioning and stacking. Preserve SideCut's theme; include functional equivalents for Videorc's optional studio appearance/meter settings without replacing the editor design. Add soundboard, monitoring, gain/mute and sync controls. Add OBS-compatible scene semantics only to the extent supported by our own compositor. Add an explicitly visible recent-clip buffer with 30- and 60-second save actions across UI, keyboard and remote commands. Map recordings/scene events and clip marks back into SideCut edits.

Accept when the same committed scene revision appears in preview, recording and stream paths, switching never produces a stale frame/deadlock, and recent-clip capture works without creating a full recording. Test buffer rearming after errors, source-recording startup with old recovery incidents, and buffer-only sessions when separate-source recording is configured. Include 30/60-second metadata and remote parity, media source failure, output resize/orientation and sound mixing. Preserve separate source tracks so a flattened studio layout is not the only editable result.

### M8 — Streaming and platform services

Start with one custom RTMP/RTMPS destination and simultaneous local recording. Add isolated per-destination queues/retry/health, multiple outputs, vertical/horizontal compositions and quality adaptation. A slow or failed target must not stall recording or other outputs. Reuse one encoded rendition where settings match; different resolution, orientation or codec requirements need distinct renditions.

Add YouTube, Twitch, Kick and X adapters individually for credentials, validation, broadcast metadata/lifecycle, scheduling and supported chat/statistics. Add TikTok/Instagram through custom RTMP where available; model native account/chat support separately. Store secrets in the host credential system. Use provider-specific quota admission and reconnect policies.

Accept first against local RTMP listeners and fake provider APIs: one target offline, token expiry, quota exhaustion, reconnect, clock drift, stopping and partial failures. Then collect opt-in real-provider evidence for each advertised integration. Availability of stream keys or platform approval is an external dependency, not solved by an RTMP preset.

### M9 — Live intelligence and post-recording workflows

Add unified chat, emotes, highlights, moderation and audience events. Then add streaming speech with partial/final word reconciliation, independent caption burn-in targets and bounded latency. Reuse offline transcript and caption models where compatible; batch transcription is not a live speech backend.

Implement the companion in small slices: profile/library and static avatars; animated avatars/reactions; questions and draft answers; flags/promises; built-in greetings with custom overrides, welcome deduplication and per-kind disable; approved posting and configurable automation; commands, clip suggestions and local reports. Model free template greetings independently from paid/cloud AI. The refreshed upstream enables greeting defaults; specify SideCut's activation/consent policy explicitly and record any intentional difference. Preserve per-platform permissions, rate limits, a kill switch and opt-in upload consent. Untrusted chat cannot execute unrestricted tools or edit timelines.

Add clean/condensed/noise-cleaned derived projects using existing edit operations, retained originals, reviewable proposals, regenerated captions/SRT and resumable jobs. Add publish-pack outputs only after specifying the external service contract and fixtures. Migrate/report failures without silently discarding completed transcript chunks or outputs.

Accept against recorded/synthetic speech/chat/provider fixtures, testing latency, reconnection, duplicate partial/final events, rate limits and consent revocation. Confirm no posting in suggest-only mode, no cloud transfer with consent off, reversible cuts and correct subtitle timing after cuts. Real AI/provider quality needs a separate measured run; mocks prove only contracts.

### M10 — Hosted account, AI and commercial services

Implement SideCut-owned account/entitlement services for hosted AI and publishing contracts, usage metering, quotas, subscription state, storage billing and account/team settings. Billing can ship after the corresponding free/test workflows, but stays in full parity scope. Make checkout/webhook updates retry-safe; verify entitlement changes server-side. Define retention, deletion and export behavior for cloud media and service data.

Accept with test billing events covering duplicate/out-of-order delivery, cancellation, expired entitlements, refunds where supported, quota reservation/release and partial job completion. No provider secret reaches the client or a project archive. Hosted-service behavior that cannot be derived from supplied source remains explicitly specified and tested as a SideCut equivalent.

### M11 — Import and remote controls

Extend the existing `ProjectAPI`, `@sidecut/client`, CLI/MCP adapters and host authority with the new studio actions. Preserve idempotency, revisions, authors, lease ownership, cancellation and change subscriptions. Add local/deck hotkeys, a reduced remote protocol, phone pairing, signed commands, per-device revoke and listener teardown. Add OBS profile/scene import using the existing import/resource diagnostics, with a visible supported-subset report and safe asset resolution. EDL and Filmora import already exist and are not prerequisites to recreate.

Accept with replayed/expired/unauthorized remote commands, secret-free reduced events, confirmed-state responses and stop-on-revoke behavior. OBS fixtures must preserve supported geometry/settings and report unsupported filters/sources without reading arbitrary referenced files.

### M12 — Distribution and parity certification

Extend the existing Windows packaging and Debian container install harnesses with recording, stream lifecycle and recording-library migrations. Complete native macOS and real Linux desktop acceptance, signing/notarization, update/recovery policy, diagnostics, output repair, redacted support bundles, settings migration and accessibility/keyboard behavior. Evaluate upstream anonymous usage-stat behavior explicitly; do not silently add telemetry to local capture. Keep permission prompts and background capture status clear. An upstream owner-waived release is not evidence for SideCut's device or installer acceptance.

Run complete capture → edit → stream → review → revise → deliver journeys for each claimed OS/browser/provider. Check installer first run, upgrade and uninstall, native worker crash, corrupt recordings, lost network, permission revocation and cloud outage. Publish the capability matrix with actual evidence and remaining upstream/external limitations. Only then label the chosen release as parity with the pinned revisions.

## Dependency order and release slices

1. M0 → M1 establishes the refreshed inventory, recording storage gaps and engine feasibility. Existing archives, relinking, SQLite and local transport are reused.
2. A short M2 capture-to-edit slice is the first user-visible implementation. M3 then adds sustained native recording. M4 can proceed independently after the shared schemas are agreed.
3. M4 + M5 → M6 delivers the complete hosted review loop.
4. M3 → M7 → M8 delivers production and multistreaming.
5. M7/M8 plus existing transcript tools → M9 delivers live intelligence and post-production automation.
6. M5 → M10 supplies hosted accounts/commercial operations; its AI gateway subset must precede M9 hosted AI acceptance.
7. M3/M7 plus the existing local service transport → M11. M12 extends current packaging evidence throughout and closes the release.

M5's cloud library and M3's native engine are independent implementation streams once contracts are stable. Do not block recording on billing, or local editing on cloud availability. Retain the completed EDL/Filmora and agent adapters; address their documented compatibility gaps only when a workflow requires them.

Suggested release slices: recording-to-edit; hosted review; live studio; multistream; intelligence/publishing; certified full parity. These are intermediate releases within the full requested scope.

## Verification policy

For every implementation slice, run the smallest meaningful fixture/test first, then `vp run check` and the affected production build (`vp run build` or `vp run build:desktop`). Reuse the existing browser, CLI/MCP/SDK, packaged Windows and Linux container verification scripts where relevant. Add native worker format/lint/tests to the root verification gate if that worker is selected. A new cloud application must add its server tests and type checking to the same workspace workflow. Check current formatting failures separately from feature regressions; earlier reports record pre-existing CSS formatting issues.

Maintain synthetic media with motion, timestamps, speech/tones and A/V sync events. Inspect actual artifacts with FFprobe/FFmpeg; file size is not a correctness test. Track preview liveness, frame cadence, CPU/GPU load, memory, disk usage, queue bounds, drift and start/stop latency. Set pass thresholds from M1 measurements and upstream behavior fixtures before performance acceptance; do not invent parity from an uncalibrated metric.

Use local RTMP endpoints, fake cloud/provider APIs and test billing for routine checks. Keep real streaming, paid AI and external publication as separate integration runs. Platform/vendor API details must be verified against current official documentation when that adapter is implemented.

## Reuse and licensing boundary

Lawn's inspected `LICENSE` is MIT. Videorc's manifest identifies AGPL-3.0-only and its repository includes the AGPL text. Choose a code-reuse policy before copying implementation or assets. The default proposal is SideCut-owned implementations based on observable workflows and independently specified interfaces; preserve notices for any permitted reused code. If direct Videorc reuse is desired, resolve the project's intended licensing/distribution model first. This plan does not determine legal compatibility or treat a process boundary as a license exemption.

Retain SideCut's existing Tandem notices. Review bundled codec binaries, avatar/background assets and model licenses separately before distribution. Brand identities and production service access are not granted by feature parity.

## Decisions to settle before the affected milestone

- M1: initial supported OS/hardware, large-file storage contract and measured quality targets; whether a new worker is needed, then its language/protocol after the capture probe.
- M5: authentication vendor, cloud deployment/regions, object storage and playback service, retention and operating budget.
- M8: initial provider order and test-account availability; exact claims for custom RTMP versus native platform integration.
- M9/M10: local versus hosted AI quality targets, publish-pack output contract, model/service budget and user data consent.
- Before any upstream code reuse: SideCut license/distribution intent and permitted asset/code reuse.

These decisions affect later implementation milestones. After approving execution, the user requested explicit phases and a first implementation. Dependencies were installed from the unchanged lockfile. LV001 and LV002 now implement short browser recording into the existing project/media path. LV003 acceptance has begun. See the [phase checklist](lawn-videorc-phases.md) and [recording verification](verification/lawn-videorc-capture.md) for current results and open platform checks. No cloud accounts, deployments, paid resources or external publication were created.
