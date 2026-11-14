# Implicit state machines in SideCut

Static source inventory, 2026-11-14. This report maps **76 workflow families** across the web editor, browser platform, desktop host, cloud backend, asset providers, CLI host launcher, and landing page. A family can contain parallel or nested machines; this is not a count of independent finite-state machines.

**I — implicit:** states and transitions are encoded by flags, nullable handles, collections, promises, timestamps, effects, or file existence.
**P — partly explicit:** a status union names the main states, but other fields and sequencing rules still determine which transitions are legal.

Arrows describe representative paths, not an exhaustive transition matrix. Labels such as “attached” and “preparing” are inferred conceptual states unless shown as code identifiers. Presence in this inventory does not imply a bug or a need for a state-machine library.

The review searched application source for state hooks, mutable class/module state, status schemas, abort controllers, queues, locks, timers, generation counters, request maps and persisted journals, then followed the main transition handlers. Pure editing/rendering calculations, third-party implementations, generated files, fixtures and verification scripts are outside the inventory. The client SDK is mostly request/response and immutable project views; the host lifecycle it uses is included below.

## Where explicit modeling would help most

1. **Browser project session.** Loading, writer ownership, save health, project replacement and operation activity overlap in one snapshot. A single flat status would lose information; separate lifecycle, ownership, persistence and operation states would express the existing rules better.
2. **Export queue.** Queue ownership/shutdown, job execution, journal persistence and output lifetime are separate machines. “Done” means more than an encoder returning a Blob.
3. **Native capture.** Recorder process, persisted recording, document ownership, permission grant and stream health evolve separately. A ready recording does not itself authorize a renderer to control the recorder.
4. **Studio recording.** Async setup, recorder callbacks, retained take, recent-clip buffer and dialog close protection are spread across refs and booleans. Startup and stop-to-take handoff deserve explicit transition rules.
5. **Renderer services.** Readiness, pending request ownership, cancellation, timeout, window death and project replacement all decide whether a reply may commit.

These are modeling priorities based on coupling and resource ownership, not confirmed defects. Existing epoch checks, locks, revision checks and serialized promises already enforce many of the required rules.

## Project ownership and persistence

### 1. Browser session lifecycle (I)

loading → attached writable/read-only → closing; startup failure → error; reopen starts a new epoch.

**Encoded by:** saveState, readOnly, busy, epoch, store, release, subscriptions. Epoch checks reject old async work; writable actions require ownership and an idle session.

**Source:** [apps/web/src/modules/workspace/browser-session.ts:426](C:/sharull/coding/personal/side-cut/apps/web/src/modules/workspace/browser-session.ts:426).

### 2. Writer ownership and follower refresh (I)

lock unavailable → follower; lock acquired → writer; close → released; follower receives broadcasts and refreshes.

**Encoded by:** release handle plus readOnly and BroadcastChannel. enableEditing flushes/acquires/reloads; the lock lifetime must cover saves.

**Source:** [packages/platform-browser/src/writer-lock.ts:1](C:/sharull/coding/personal/side-cut/packages/platform-browser/src/writer-lock.ts:1); [apps/web/src/modules/workspace/browser-session.ts:890](C:/sharull/coding/personal/side-cut/apps/web/src/modules/workspace/browser-session.ts:890).

### 3. Project import/replacement and recovery (I)

idle → reading/validating/staging → replacing → attached; unsupported input → retained original; failure preserves a recoverable project.

**Encoded by:** busy, epoch, unsupportedJSON, archivedRaw, staged resources. Import, new project, archive and native recording import share this lifecycle.

**Source:** [apps/web/src/modules/workspace/browser-session.ts:954](C:/sharull/coding/personal/side-cut/apps/web/src/modules/workspace/browser-session.ts:954).

### 4. Browser autosave (P)

saved/error → saving → saved/error; more edits queue more saves; flush waits for the tail.

**Encoded by:** latest, tail, failure. Only the latest queued save publishes the final save state.

**Source:** [packages/platform-browser/src/save-queue.ts:3](C:/sharull/coding/personal/side-cut/packages/platform-browser/src/save-queue.ts:3).

### 5. Desktop save and project replacement (P)

saved → saving → saved/error; replace waits for pending saves, validates expected generation/revision, then installs a new coordinator.

**Encoded by:** state, error, pending, replacing, savedRevision, generation. Import cannot discard a failed unsaved edit.

**Source:** [apps/desktop/src/main/project-service.ts:28](C:/sharull/coding/personal/side-cut/apps/desktop/src/main/project-service.ts:28).

### 6. Native project store ownership (I)

unlocked → locked/open → saving → closed; stale file ownership/version rejects writes.

**Encoded by:** token, locked, expected, connection, portableOriginal. Lock ownership and database/file versions jointly authorize writes.

**Source:** [apps/desktop/src/main/project-store.ts:45](C:/sharull/coding/personal/side-cut/apps/desktop/src/main/project-store.ts:45).

### 7. Edit history and publication (I)

apply → new undo history and cleared redo; undo/redo move entries; publication temporarily rejects reentrant edits.

**Encoded by:** undoStack, redoStack, results, revision, journal, publishing. Request IDs deduplicate commits; revision checks reject stale edits.

**Source:** [packages/core/src/coordinator.ts:341](C:/sharull/coding/personal/side-cut/packages/core/src/coordinator.ts:341).

### 8. Host snapshot synchronization (I)

receive newer snapshot → decode/publish; stale sequence ignored; generation change replaces the project view; close unsubscribes.

**Encoded by:** wire, snapshot, sequence/generation, stop callback and cached journal.

**Source:** [apps/web/src/modules/workspace/host-coordinator.ts:11](C:/sharull/coding/personal/side-cut/apps/web/src/modules/workspace/host-coordinator.ts:11).

### 9. Storage connection and worker requests (I)

unopened → connecting → ready; connect failure → retryable unopened; each worker request → reply/error/worker failure.

**Encoded by:** cached connection promise, worker readiness, request IDs and pending callbacks. Native bridge and browser worker use separate adapters.

**Source:** [packages/platform-browser/src/sqlite-client.ts:80](C:/sharull/coding/personal/side-cut/packages/platform-browser/src/sqlite-client.ts:80); [packages/platform-browser/src/sqlite-worker.ts](C:/sharull/coding/personal/side-cut/packages/platform-browser/src/sqlite-worker.ts).

### 10. Native file staging (I)

begin → append chunks → seal; failure → abort.

**Encoded by:** staged Map and temporary files. A staged upload and a published file have different allowed operations.

**Source:** [apps/desktop/src/main/sqlite-storage.ts:28](C:/sharull/coding/personal/side-cut/apps/desktop/src/main/sqlite-storage.ts:28).

### 11. Legacy migration and preference hydration (I)

unmigrated → read/encode legacy data → atomic commit with migration marker; preferences unopened → loading → cached or retryable failure.

**Encoded by:** migration marker, storage checks, cached ready promise and values Map.

**Source:** [packages/platform-browser/src/legacy-storage.ts](C:/sharull/coding/personal/side-cut/packages/platform-browser/src/legacy-storage.ts); [packages/platform-browser/src/preferences.ts](C:/sharull/coding/personal/side-cut/packages/platform-browser/src/preferences.ts).

### 12. Workspace layout persistence (I)

hydrating → ready/protected/error; user layout change → saving → persisted/error; viewport thresholds hide panels.

**Encoded by:** preferencesReady, layoutProtected, preferenceError, keymapError, previousWidth. Writes wait for hydration and layout protection to clear.

**Source:** [apps/web/src/modules/workspace/workspace-home.tsx:128](C:/sharull/coding/personal/side-cut/apps/web/src/modules/workspace/workspace-home.tsx:128).

## Playback and editor interactions

### 13. Editor transport (I)

paused ↔ forward/reverse playback; repeated shuttle accelerates; seek restarts playback; end/visibility change pauses.

**Encoded by:** playing, playbackRate, playhead, seekVersion span the Zustand store, viewer effects and preview.

**Source:** [apps/web/src/modules/workspace/editor-view.ts:7](C:/sharull/coding/personal/side-cut/apps/web/src/modules/workspace/editor-view.ts:7); [apps/web/src/modules/workspace/viewer.tsx:12](C:/sharull/coding/personal/side-cut/apps/web/src/modules/workspace/viewer.tsx:12).

### 14. Preview preparation and resource lifetime (I)

stopped → preparing audio/readers → playing → stopped; release drops readers/audio; close permanently disposes.

**Encoded by:** playing, token, disposed, audioWork, AudioContext, clock, nodes, animation. New work invalidates earlier work with a token.

**Source:** [apps/web/src/modules/workspace/source-preview.ts:10](C:/sharull/coding/personal/side-cut/apps/web/src/modules/workspace/source-preview.ts:10).

### 15. Preview paint scheduling (I)

idle → drawing; seeks while drawing replace wanted frame; drain → idle; stale frame results are dropped.

**Encoded by:** painting, wanted, token, scratch canvas. This is a separate latest-request queue inside playback.

**Source:** [apps/web/src/modules/workspace/source-preview.ts:130](C:/sharull/coding/personal/side-cut/apps/web/src/modules/workspace/source-preview.ts:130).

### 16. Media reader lifetime (I)

opening → usable image/animation/video/audio reader → closed; optional proxy selection changes frame source.

**Encoded by:** nullable input/sinks/image/animation, closed, proxy, proxyBitmap. Readers own decoding resources and cached bitmaps.

**Source:** [packages/platform-browser/src/preview.ts:8](C:/sharull/coding/personal/side-cut/packages/platform-browser/src/preview.ts:8).

### 17. Review playback/shuttle (I)

paused ↔ native forward playback or timer-driven reverse; seek/step changes position; version change cancels old playback.

**Encoded by:** playing, rate, shuttle, timer, generation and HTMLMediaElement state.

**Source:** [apps/web/src/modules/workspace/review-player.tsx:16](C:/sharull/coding/personal/side-cut/apps/web/src/modules/workspace/review-player.tsx:16).

### 18. Timeline clip gesture (P)

idle → captured move/trim/ripple/roll/slip/slide → preview → commit or cancel; suppress the follow-up click.

**Encoded by:** Gesture has an operation field, but active ref, React gesture, capture, suppressed and selectedByPointer hold the lifecycle. Commit uses the captured revision.

**Source:** [apps/web/src/modules/workspace/clip-block.tsx:54](C:/sharull/coding/personal/side-cut/apps/web/src/modules/workspace/clip-block.tsx:54).

### 19. Timeline range, box selection and playhead drag (I)

idle → pointer capture → scrub/select/range update → release/cancel; ignore click following a drag.

**Encoded by:** drag ref, box, ignoreClick, tool and selection. Track naming has a separate editing/commit/cancel cycle.

**Source:** [apps/web/src/modules/workspace/timeline.tsx:149](C:/sharull/coding/personal/side-cut/apps/web/src/modules/workspace/timeline.tsx:149).

### 20. Numeric/text input editing and scrubbing (I)

displaying → local draft or pointer scrub → commit/cancel → displaying.

**Encoded by:** draft, scrubbing, scrub ref and pointer capture. Enter/blur commit; Escape/pointer cancel restore a draft/value.

**Source:** [apps/web/src/modules/workspace/commit-input.tsx:37](C:/sharull/coding/personal/side-cut/apps/web/src/modules/workspace/commit-input.tsx:37).

### 21. Transition duration drag (I)

idle → captured duration draft → commit/cancel.

**Encoded by:** open, draft and drag ref containing original duration and revision.

**Source:** [apps/web/src/modules/workspace/transition-controls.tsx:253](C:/sharull/coding/personal/side-cut/apps/web/src/modules/workspace/transition-controls.tsx:253).

### 22. Panel resizing and drag autoscroll (I)

idle → pointer resize or edge-scroll → release/cancel/unmount.

**Encoded by:** pointer ref and resize origin; autoscroll has active element, animation frame and last timestamp.

**Source:** [apps/web/src/modules/workspace/panel-divider.tsx:27](C:/sharull/coding/personal/side-cut/apps/web/src/modules/workspace/panel-divider.tsx:27); [apps/web/src/modules/workspace/drag-autoscroll.ts:13](C:/sharull/coding/personal/side-cut/apps/web/src/modules/workspace/drag-autoscroll.ts:13).

### 23. In/out range construction (I)

neither endpoint → in-only/out-only → complete range; moving an endpoint past the other clears the invalid endpoint.

**Encoded by:** inPoint, outPoint, range are three synchronized representations; setRange/reset also update all three.

**Source:** [apps/web/src/modules/workspace/editor-view.ts:91](C:/sharull/coding/personal/side-cut/apps/web/src/modules/workspace/editor-view.ts:91).

### 24. Selection, tools and clipboard (I)

empty ↔ single/multiple/linked selection; copy populates clipboard; tool changes determine pointer behavior; project change resets transient state.

**Encoded by:** selected, linkedSelection, tool, clipboard ref and hasClipboard; viewer filters deleted clip IDs.

**Source:** [apps/web/src/modules/workspace/edit-actions.ts:25](C:/sharull/coding/personal/side-cut/apps/web/src/modules/workspace/edit-actions.ts:25); [apps/web/src/modules/workspace/editor-view.ts:7](C:/sharull/coding/personal/side-cut/apps/web/src/modules/workspace/editor-view.ts:7).

## Jobs, recording and delivery

### 25. Background jobs and concurrency (P)

queued → running → done/failed/cancelled; queued cancellation settles immediately; running cancellation drains before freeing capacity.

**Encoded by:** Entry state plus controller and active count. A cancelled running job still occupies a slot until finally runs.

**Source:** [packages/platform-browser/src/jobs.ts:17](C:/sharull/coding/personal/side-cut/packages/platform-browser/src/jobs.ts:17).

### 26. Per-source analysis (I)

absent/cached → queued/running operation → Ready or Stopped; reset invalidates the generation.

**Encoded by:** optional samples/proxy/transcript/matte, status/error, pending keyed by operation and media, generation. Multiple operation types can coexist for one source.

**Source:** [apps/web/src/modules/workspace/media-analysis.ts:15](C:/sharull/coding/personal/side-cut/apps/web/src/modules/workspace/media-analysis.ts:15).

### 27. Browser recording and ordered writes (P)

idle/error → requesting → recording → stopping → ready/error; discard/close cancels and releases resources.

**Encoded by:** RecordingState is explicit; Run also carries cancelled, failure, pending bytes, writes, completion, streams, file and recorder. Finalization waits for writes.

**Source:** [packages/platform-browser/src/recording.ts:11](C:/sharull/coding/personal/side-cut/packages/platform-browser/src/recording.ts:11).

### 28. Durable saved recording and lease (P)

capturing → ready/interrupted → imported/exported/deleted; active recording stays leased and hidden from saved-recording actions.

**Encoded by:** RecordingEntry status, per-recording Web Lock and the RecordingFile closure. Preserve/removal release the lease; partial recordings require separate handling.

**Source:** [packages/platform-browser/src/recording-storage.ts:73](C:/sharull/coding/personal/side-cut/packages/platform-browser/src/recording-storage.ts:73); [packages/core/src/recordings.ts:17](C:/sharull/coding/personal/side-cut/packages/core/src/recordings.ts:17).

### 29. Capture permission grant (I)

absent → awaiting approval → approved → display selection pending/granted → released/expired/revoked.

**Encoded by:** Grant approved, expires, displayPending, displayGranted and document identity. Screen microphone permission depends on displayGranted; navigation revokes the grant.

**Source:** [apps/desktop/src/main/capture-permissions.ts:13](C:/sharull/coding/personal/side-cut/apps/desktop/src/main/capture-permissions.ts:13).

### 30. Native recorder process and recovery (P)

initializing → available → starting/recording → stopping/finalizing → ready/error; startup recovers recording/stopping journals as interrupted; retry finalizes retained data.

**Encoded by:** persisted recording status plus session, busy, closed, initialized promise, child process and completion. Process exit and explicit stop converge on finalization.

**Source:** [apps/desktop/src/main/native-recorder.ts:77](C:/sharull/coding/personal/side-cut/apps/desktop/src/main/native-recorder.ts:77).

### 31. Native recorder document ownership (I)

unowned → approval/start in progress → started → stopping → disposed; navigation/destruction invalidates the owner.

**Encoded by:** owner object has invalid, started, stopping, id, sender/frame. This authorizes renderer control independently of recorder status.

**Source:** [apps/desktop/src/main/native-recorder-ipc.ts:13](C:/sharull/coding/personal/side-cut/apps/desktop/src/main/native-recorder-ipc.ts:13).

### 32. Native streaming targets (P)

off → configured/live target state → failed or stopped; overall state reflects target failures.

**Encoded by:** stream session and per-target state are attached to the native recording process; FFmpeg diagnostics update target health.

**Source:** [apps/desktop/src/main/native-recorder.ts:330](C:/sharull/coding/personal/side-cut/apps/desktop/src/main/native-recorder.ts:330); [packages/contracts/src/native-recording.ts](C:/sharull/coding/personal/side-cut/packages/contracts/src/native-recording.ts).

### 33. Native recording library actions (I)

retained recording → remux/repair/thumbnail/export/import/delete → completed or failed.

**Encoded by:** saved-recording guards, on-disk parts/manifests and temporary outputs. UI separately serializes polling and actions with generation checks.

**Source:** [apps/desktop/src/main/native-recording-library.ts:79](C:/sharull/coding/personal/side-cut/apps/desktop/src/main/native-recording-library.ts:79); [apps/web/src/modules/workspace/native-recording-library.tsx:38](C:/sharull/coding/personal/side-cut/apps/web/src/modules/workspace/native-recording-library.tsx:38).

### 34. Export queue ownership and shutdown (I)

unconfigured → lock acquired/blocked → available/running → stopping → drained and lock released.

**Encoded by:** running, stopping, blocked, releaseWriter, durable and operations. Release waits for running export and serialized operations.

**Source:** [packages/platform-browser/src/export-queue.ts:11](C:/sharull/coding/personal/side-cut/packages/platform-browser/src/export-queue.ts:11).

### 35. Export job, persistence and recovery (P)

queued → running → done/failed/cancelled; shutdown → interrupted; retry → queued; recovery can promote a retained valid output to done.

**Encoded by:** ExportEntry and Delivery statuses plus tasks, records, pending, outputs and contexts. Output persistence occurs before final done commit; removal must cancel and clean files/URLs.

**Source:** [packages/platform-browser/src/export-queue.ts:66](C:/sharull/coding/personal/side-cut/packages/platform-browser/src/export-queue.ts:66); [packages/platform-browser/src/export-queue.ts:287](C:/sharull/coding/personal/side-cut/packages/platform-browser/src/export-queue.ts:287); [packages/core/src/delivery-store.ts](C:/sharull/coding/personal/side-cut/packages/core/src/delivery-store.ts).

### 36. Native encoding/publication journal (P)

encoding → verified → published; failure → failed; recovery publishes verified output or fails interrupted encoding.

**Encoded by:** Journal state plus temporary/final file existence and output reference. Verification and publication are separate durable transitions.

**Source:** [apps/desktop/src/main/delivery-service.ts:75](C:/sharull/coding/personal/side-cut/apps/desktop/src/main/delivery-service.ts:75).

### 37. Delivery IPC requests and shutdown (I)

accepting → request owned/running → reply/cancel; closing rejects new work and drains completions.

**Encoded by:** closing, completions and jobs keyed by request and sender. Cancellation and window lifetime govern request ownership.

**Source:** [apps/desktop/src/main/delivery-ipc.ts:11](C:/sharull/coding/personal/side-cut/apps/desktop/src/main/delivery-ipc.ts:11).

### 38. Export and recording file destinations (I)

allocated → writing → finalized/retained → released; error → abort/remove temporary file.

**Encoded by:** writer/target handles and release callbacks rather than an enum. Output lifetime continues after encoding succeeds.

**Source:** [packages/platform-browser/src/export-output.ts](C:/sharull/coding/personal/side-cut/packages/platform-browser/src/export-output.ts); [packages/platform-browser/src/durable-delivery.ts](C:/sharull/coding/personal/side-cut/packages/platform-browser/src/durable-delivery.ts); [apps/desktop/src/main/recording-output.ts](C:/sharull/coding/personal/side-cut/apps/desktop/src/main/recording-output.ts).

## Live studio and integrations

### 39. Saved scene versus active program (I)

no active scene → explicit switch → active immutable snapshot; saving a newer scene does not switch the program.

**Encoded by:** scenes Map, selected scene UI, active snapshot, saved revision and commitRevision. Removing the active scene is forbidden.

**Source:** [packages/core/src/live-studio.ts:37](C:/sharull/coding/personal/side-cut/packages/core/src/live-studio.ts:37).

### 40. Live program output (I)

no committed frame → rendering → committed; capture binds a stream/audio mix; close releases owned tracks.

**Encoded by:** busy, closed, committed, stream, audioInputId. Recording requires a complete frame; changed scene revision discards an in-flight frame.

**Source:** [packages/platform-browser/src/live-studio.ts:7](C:/sharull/coding/personal/side-cut/packages/platform-browser/src/live-studio.ts:7).

### 41. Studio panel initialization and source acquisition (I)

loading scenes → ready/error; request camera/screen/microphone → live input → removed/ended; unmount releases resources.

**Encoded by:** loading, alive, studio/output/mixer refs, sources/audioInputs and device promises. These resources share the panel lifetime.

**Source:** [apps/web/src/modules/studio/studio-panel.tsx:70](C:/sharull/coding/personal/side-cut/apps/web/src/modules/studio/studio-panel.tsx:70).

### 42. Studio program recording and unsaved take (I)

ready → starting → recording → stopping → retained take → importing/discarded.

**Encoded by:** recording boolean, recorder ref, take, async programStream and MediaRecorder callbacks. Dialog busy/onBusy prevents closing with recording or retained output.

**Source:** [apps/web/src/modules/studio/studio-panel.tsx:374](C:/sharull/coding/personal/side-cut/apps/web/src/modules/studio/studio-panel.tsx:374); [apps/web/src/modules/studio/studio-dialog.tsx:14](C:/sharull/coding/personal/side-cut/apps/web/src/modules/studio/studio-dialog.tsx:14).

### 43. Recent clip ring and clip saving (I)

disarmed → armed/segment recording → segment rotation; save locks a selection and produces clip; stop/source failure → released.

**Encoded by:** run, saving, stopped, failure, recorder, timer, finish and buffer. Rearming is forbidden during a save.

**Source:** [packages/platform-browser/src/recent-clips.ts:31](C:/sharull/coding/personal/side-cut/packages/platform-browser/src/recent-clips.ts:31); [apps/web/src/modules/studio/studio-panel.tsx:96](C:/sharull/coding/personal/side-cut/apps/web/src/modules/studio/studio-panel.tsx:96).

### 44. Live audio channel, mixer and soundboard (I)

open → configured/routed/resumed; sound start → playing → ended/stopped; close → unusable.

**Encoded by:** closed flags, input/channel ownership, sounds Map and AudioContext state. Removing an input disconnects its nodes.

**Source:** [packages/platform-browser/src/live-audio.ts:6](C:/sharull/coding/personal/side-cut/packages/platform-browser/src/live-audio.ts:6).

### 45. Live chat connection and highlighted message (P)

per-provider connect establishes a generation; disconnect/quota disables it; hidden/highlighted message changes overlay state.

**Encoded by:** connections with generation/connection flags, selected message and dedupe Maps. Old-generation events are ignored.

**Source:** [packages/core/src/live-chat.ts:36](C:/sharull/coding/personal/side-cut/packages/core/src/live-chat.ts:36).

### 46. Live captions connection and segment revisions (I)

disconnected → connected with new generation → receive/revise segments → disconnected; routing chooses output targets.

**Encoded by:** connected, generation, segment revisions, target Set and latency. Stale connection updates are rejected.

**Source:** [packages/core/src/live-captions.ts:15](C:/sharull/coding/personal/side-cut/packages/core/src/live-captions.ts:15).

### 47. Companion visibility and reactions (I)

inactive → active profile → timed reaction → normal frame; deactivate/remove clears active state.

**Encoded by:** active profile ID, reaction kind/start and time supplied to frame(). This is a visual state machine, not an external agent runtime.

**Source:** [packages/core/src/live-companion.ts:17](C:/sharull/coding/personal/side-cut/packages/core/src/live-companion.ts:17).

### 48. Companion proposal and posting consent (P)

consent off/on and suggest-only/post-enabled; proposal suggested → posting → posted/failed; reconfiguration aborts work.

**Encoded by:** proposal.state plus consent, suggestOnly, enabled kinds, posting, lastPost and controller. Failed ambiguous delivery is not automatically retried.

**Source:** [packages/core/src/companion-behavior.ts:25](C:/sharull/coding/personal/side-cut/packages/core/src/companion-behavior.ts:25).

### 49. Provider availability, throttling and request UI (P)

disabled/missing capability or credentials → ready/limited; idle → searching/fetching/generating → result/error/cancelled; credentials/config change recomputes availability.

**Encoded by:** ProviderInfo status, ProviderHTTP active/times/cache, UI busy/controller/notice/error and confirmation. Generation requires explicit paid-request confirmation.

**Source:** [packages/assets/src/provider.ts:84](C:/sharull/coding/personal/side-cut/packages/assets/src/provider.ts:84); [apps/web/src/modules/workspace/provider-browser.tsx:16](C:/sharull/coding/personal/side-cut/apps/web/src/modules/workspace/provider-browser.tsx:16).

### 50. Generated asset retention and recovery (I)

requested → file(s) saved → manifest committed → recoverable/imported; incomplete manifest stays unavailable.

**Encoded by:** generated folders, asset.json completion marker, save callback and browser library entries. Completed takes survive cancellation of later work.

**Source:** [apps/desktop/src/main/asset-providers.ts:59](C:/sharull/coding/personal/side-cut/apps/desktop/src/main/asset-providers.ts:59); [packages/platform-browser/src/asset-providers.ts:174](C:/sharull/coding/personal/side-cut/packages/platform-browser/src/asset-providers.ts:174).

### 51. Twitch account connection (I)

connected → request → connected; explicit disconnect or 401 → disconnected and aborted.

**Encoded by:** token plus AbortController. Response processing rechecks that the account is still connected.

**Source:** [apps/desktop/src/main/twitch-broadcast-account.ts:4](C:/sharull/coding/personal/side-cut/apps/desktop/src/main/twitch-broadcast-account.ts:4).

## Host services and cloud

### 52. Stable folder watch (I)

file unseen → settling → emitted/known; changing signature restarts settling; disappearance removes candidate; watcher closes permanently.

**Encoded by:** pending timestamps/signatures, known signatures, running, stopped and timer. Polls cannot overlap.

**Source:** [apps/desktop/src/main/folder-scanner.ts:51](C:/sharull/coding/personal/side-cut/apps/desktop/src/main/folder-scanner.ts:51).

### 53. Renderer readiness and request/reply (I)

renderer unavailable/ready; request sent → pending → reply/error/timeout/cancel/window destroyed.

**Encoded by:** ready Set, pending Map, sender identity, timeout and abort handlers. Reply settlement checks captured project generation/revision.

**Source:** [apps/desktop/src/main/renderer-service.ts:10](C:/sharull/coding/personal/side-cut/apps/desktop/src/main/renderer-service.ts:10).

### 54. Native IPC job and folder-watch ownership (I)

sender starts job/watch → owned running → cancelled/replaced/closed; shutdown drains running tasks.

**Encoded by:** per-sender folders, request controllers and running promises; recording-to-directory has its own per-sender destination and running controller.

**Source:** [apps/desktop/src/main/native-ipc.ts:15](C:/sharull/coding/personal/side-cut/apps/desktop/src/main/native-ipc.ts:15); [apps/desktop/src/main/recording-ipc.ts:12](C:/sharull/coding/personal/side-cut/apps/desktop/src/main/recording-ipc.ts:12).

### 55. Local HTTP request, leases and host lifetime (I)

server starting → listening → draining/closed; requests active → settled/aborted; leases active → renewed/released/expired.

**Encoded by:** active, controllers, pending, leases and lease timer. Parent death plus no leases/background jobs triggers quit.

**Source:** [apps/desktop/src/main/http-service.ts:8](C:/sharull/coding/personal/side-cut/apps/desktop/src/main/http-service.ts:8); [apps/desktop/src/main/main.ts:280](C:/sharull/coding/personal/side-cut/apps/desktop/src/main/main.ts:280).

### 56. Desktop quit (I)

running → quit requested → close delivery/recorder/native/HTTP/project → exit or failure.

**Encoded by:** quitting guard and async close chain prevent repeated before-quit handlers from restarting shutdown.

**Source:** [apps/desktop/src/main/main.ts:335](C:/sharull/coding/personal/side-cut/apps/desktop/src/main/main.ts:335).

### 57. CLI headless-host acquisition (I)

discover existing owner → reuse, or spawn → wait for authoritative owner → acquire lease → renew → release/cleanup.

**Encoded by:** found, child, profile, closed, lease and owners cleanup Set. Reuse and newly spawned ownership have different cleanup responsibilities.

**Source:** [scripts/headless-host.mjs:41](C:/sharull/coding/personal/side-cut/scripts/headless-host.mjs:41).

### 58. Remote device pairing and command execution (I)

no code → code pending → local approval → paired → revoked; command idle → busy → settled.

**Encoded by:** pairing expiry, generation, lifetime abort, devices, sequence and per-device busy/controller. Close invalidates pending approvals; sequence prevents replay.

**Source:** [apps/desktop/src/main/remote-control.ts:33](C:/sharull/coding/personal/side-cut/apps/desktop/src/main/remote-control.ts:33).

### 59. Cloud login and client bootstrap (I)

config unavailable or loading client → unauthenticated/authenticated; login starts once → redirect or error; cleanup closes the client.

**Encoded by:** configuration, client ref/state, started ref, authentication state and error.

**Source:** [apps/web/src/modules/cloud/login-redirect.tsx:24](C:/sharull/coding/personal/side-cut/apps/web/src/modules/cloud/login-redirect.tsx:24); [apps/web/src/modules/cloud/teams-panel.tsx:36](C:/sharull/coding/personal/side-cut/apps/web/src/modules/cloud/teams-panel.tsx:36).

### 60. Cloud media upload and processing (P)

uploading with multipart receipts → processing → ready/failed; retry failed → processing with incremented attempt.

**Encoded by:** version.status, attempt, uploadId, part receipts, byte total and output keys. Stale processing callbacks cannot replace a newer attempt.

**Source:** [apps/cloud/src/convex/versions.ts](C:/sharull/coding/personal/side-cut/apps/cloud/src/convex/versions.ts).

### 61. Cloud publish job and lease/checkpoints (P)

queued → claimed running → checkpoint 1 → checkpoint 2/ready; cancel/revocation → cancelled; exhausted/invalid work → failed; expired lease can be resumed.

**Encoded by:** status, attempt, leaseUntil, checkpoint, artifacts, consent and access. Checkpoints require matching attempt and a live lease.

**Source:** [apps/cloud/src/convex/publishJobs.ts:131](C:/sharull/coding/personal/side-cut/apps/cloud/src/convex/publishJobs.ts:131).

### 62. Cloud entitlement and usage reservation (I)

enabled/disabled/expired/exhausted entitlement; reservation → partial consumption → full consumption or release.

**Encoded by:** enabled, expiresAt, limit/used/reserved, reservation consumed/remaining and billing sequence. Billing events are deduplicated and ordered.

**Source:** [apps/cloud/src/convex/accounts.ts:14](C:/sharull/coding/personal/side-cut/apps/cloud/src/convex/accounts.ts:14).

### 63. Cloud share grant and guest session (I)

grant created → allowed/password checked → guest session opened → expired/revoked/unavailable; comment/download permissions gate actions.

**Encoded by:** grant/session expiry, revoked/private flags, token hashes, password verifier and access checks. Authorization is checked again when serving content.

**Source:** [apps/cloud/src/convex/shareAccess.ts](C:/sharull/coding/personal/side-cut/apps/cloud/src/convex/shareAccess.ts); [apps/cloud/src/convex/shares.ts](C:/sharull/coding/personal/side-cut/apps/cloud/src/convex/shares.ts).

### 64. Cloud invitation and membership (P)

pending → accepted/revoked; expiration makes pending invitation unusable; membership role/removal changes access.

**Encoded by:** invitation status/expiry and separate membership row. Acceptance checks identity and team permissions.

**Source:** [apps/cloud/src/convex/teams.ts](C:/sharull/coding/personal/side-cut/apps/cloud/src/convex/teams.ts).

### 65. Cloud library and review workflow (P)

media active ↔ archived; readyVersionId advances to a newer completed version; workflow changes under expected revision; comments open ↔ resolved.

**Encoded by:** archived, readyVersionId, workflow/workflowRevision and resolved fields. These are parallel state dimensions rather than upload status.

**Source:** [apps/cloud/src/convex/library.ts](C:/sharull/coding/personal/side-cut/apps/cloud/src/convex/library.ts); [apps/cloud/src/convex/shares.ts:279](C:/sharull/coding/personal/side-cut/apps/cloud/src/convex/shares.ts:279); [apps/cloud/src/convex/versions.ts](C:/sharull/coding/personal/side-cut/apps/cloud/src/convex/versions.ts).

### 66. Rendered-review selection, loading and mutations (I)

load versions → select version → load artifact/threads → ready; mutation → refresh/error; version/project change invalidates stale completion.

**Encoded by:** versionID, url, threads, busy, mutation ref, generation, mounted/active flags and object URL lifetime.

**Source:** [apps/web/src/modules/workspace/rendered-review.tsx:27](C:/sharull/coding/personal/side-cut/apps/web/src/modules/workspace/rendered-review.tsx:27).

## Smaller UI and presentation machines

### 67. Asset library operations (I)

unopened → loading → available; import/remove/use → busy → result/error; selection drives preview lifetime.

**Encoded by:** library, entries, selected, busy, error/notice and effect cleanup. This wraps the separate provider request machine.

**Source:** [apps/web/src/modules/workspace/asset-library.tsx:21](C:/sharull/coding/personal/side-cut/apps/web/src/modules/workspace/asset-library.tsx:21).

### 68. Saved recordings and directory export (I)

loading → available → action pending → refreshed/error; destination unselected → browser/native directory chosen.

**Encoded by:** entries, directory/nativeDirectory, busy and pending ref; lease guards authorize access to retained recordings.

**Source:** [apps/web/src/modules/workspace/saved-recordings.tsx:27](C:/sharull/coding/personal/side-cut/apps/web/src/modules/workspace/saved-recordings.tsx:27); [packages/platform-browser/src/recording-storage.ts](C:/sharull/coding/personal/side-cut/packages/platform-browser/src/recording-storage.ts).

### 69. Lazy recording poster and source samples (I)

offscreen → visible → requested → loaded; busy recording action → delayed retry; unmount cancels publication.

**Encoded by:** visible, requested, poster, attempt and active effect. SourceSamples similarly starts analysis only when visible.

**Source:** [apps/web/src/modules/workspace/native-recording-library.tsx:191](C:/sharull/coding/personal/side-cut/apps/web/src/modules/workspace/native-recording-library.tsx:191); [apps/web/src/modules/workspace/source-samples.tsx:12](C:/sharull/coding/personal/side-cut/apps/web/src/modules/workspace/source-samples.tsx:12).

### 70. Audio measurement and speech preparation (I)

idle → measuring/preparing → result/error/cancel; dialog open can trigger preparation.

**Encoded by:** working/measured/error/controller for audio; preparing/open flags and shared analysis state for speech.

**Source:** [apps/web/src/modules/workspace/audio-controls.tsx:17](C:/sharull/coding/personal/side-cut/apps/web/src/modules/workspace/audio-controls.tsx:17); [apps/web/src/modules/workspace/speech-tools.tsx:64](C:/sharull/coding/personal/side-cut/apps/web/src/modules/workspace/speech-tools.tsx:64).

### 71. Local comment composition and resolution (I)

viewing → composing/editing → commit/cancel; comment open ↔ resolved.

**Encoded by:** composing, draft, editing, editDraft plus persisted comment resolution. Rendered-review threads also have reply and resolution transitions.

**Source:** [apps/web/src/modules/workspace/comments-panel.tsx:36](C:/sharull/coding/personal/side-cut/apps/web/src/modules/workspace/comments-panel.tsx:36); [packages/core/src/review-library.ts:197](C:/sharull/coding/personal/side-cut/packages/core/src/review-library.ts:197).

### 72. Team/library mutations (I)

idle → submitting create/invite/accept/move/archive/etc. → success/error; selected team determines the loaded view.

**Encoded by:** busy, error/message, selected team/items and reactive query availability. These are UI wrappers over cloud domain machines.

**Source:** [apps/web/src/modules/cloud/teams-panel.tsx:113](C:/sharull/coding/personal/side-cut/apps/web/src/modules/cloud/teams-panel.tsx:113); [apps/web/src/modules/cloud/library-browser.tsx:36](C:/sharull/coding/personal/side-cut/apps/web/src/modules/cloud/library-browser.tsx:36).

### 73. Diagnostics and support report (I)

not run → running → result/error; support report pending → download/error; unmount suppresses updates.

**Encoded by:** running/result/error/download and a separate reportPending/reportError/reportDownload plus active ref.

**Source:** [apps/web/src/modules/diagnostics/diagnostics-page.tsx:15](C:/sharull/coding/personal/side-cut/apps/web/src/modules/diagnostics/diagnostics-page.tsx:15).

### 74. Wait for analysis/export completion (I)

validate targets → schedule needed work → observe pending → finished/failed/timed out/cancelled/project replaced.

**Encoded by:** captured project ID, deadline, job/analysis snapshots and AbortSignal. Cancelling the waiter does not own cancellation of analysis.

**Source:** [apps/web/src/modules/workspace/service-wait.ts](C:/sharull/coding/personal/side-cut/apps/web/src/modules/workspace/service-wait.ts); [apps/desktop/src/main/project-api.ts:81](C:/sharull/coding/personal/side-cut/apps/desktop/src/main/project-api.ts:81).

### 75. Dialog, form and transient UI family (I)

closed → editing → submitting/validation error → success/closed; tabs, filters and expanded rows change the visible mode.

**Encoded by:** open, error, done/notice, requestedDialog and draft fields. Repeated across adjustment/title/template/time/region/format dialogs, section cards, saved segments, clip/effect/text/picture/transition controls, project settings, shortcuts, media bin, history, inspector, side panels, export and recording controls. Simple toggles belong here rather than being independent architectural problems.

**Source:** [apps/web/src/modules/workspace/adjustment-dialog.tsx](C:/sharull/coding/personal/side-cut/apps/web/src/modules/workspace/adjustment-dialog.tsx); [apps/web/src/modules/workspace/section-cards.tsx:41](C:/sharull/coding/personal/side-cut/apps/web/src/modules/workspace/section-cards.tsx:41); [apps/web/src/modules/workspace/saved-segments.tsx](C:/sharull/coding/personal/side-cut/apps/web/src/modules/workspace/saved-segments.tsx); [apps/web/src/modules/workspace/media-bin.tsx:92](C:/sharull/coding/personal/side-cut/apps/web/src/modules/workspace/media-bin.tsx:92).

### 76. Landing demo timing and motion (I)

out of view/paused → timed step loop; reduced motion selects a static final state; typing cycles characters/lines; hover can pause the workflow.

**Encoded by:** step, line/typed, active/playing/hovering, settled/cycle/morph and viewport/reduced-motion state. Hydration precedes motion preference handling; navigation also tracks scrolled state.

**Source:** [apps/landing/src/lib/use-demo-loop.ts](C:/sharull/coding/personal/side-cut/apps/landing/src/lib/use-demo-loop.ts); [apps/landing/src/components/agents.tsx:69](C:/sharull/coding/personal/side-cut/apps/landing/src/components/agents.tsx:69); [apps/landing/src/components/workflow.tsx:96](C:/sharull/coding/personal/side-cut/apps/landing/src/components/workflow.tsx:96); [apps/landing/src/components/exploded-stack.tsx:81](C:/sharull/coding/personal/side-cut/apps/landing/src/components/exploded-stack.tsx:81); [apps/landing/src/lib/use-reduced-motion.ts](C:/sharull/coding/personal/side-cut/apps/landing/src/lib/use-reduced-motion.ts); [apps/landing/src/components/site-nav.tsx:16](C:/sharull/coding/personal/side-cut/apps/landing/src/components/site-nav.tsx:16).

## Existing explicit states worth preserving

The browser recording union, export-entry union, background-job statuses, native-recording statuses, delivery journal states, cloud upload states, publish-job statuses, invitation statuses and companion-proposal statuses already name much of their lifecycle. Their rows are marked P because their companion resources, attempts, leases or ownership flags still carry additional state.

Some state is intentionally parallel. Playing forward/reverse, holding an in/out range, selecting clips and opening a dialog can coexist. Likewise, the recent-clip buffer can run alongside program recording. Combining every flag into a single application-wide enum would obscure these relationships.

## Verification and limits

This is a source inspection, not runtime verification or a proof of completeness. No app behavior was changed and no tests or browser/device sessions were run. Simple repeated forms and presentation toggles are grouped explicitly to avoid presenting each boolean as a separate design problem. Dormant core integrations are included where implemented; inclusion does not establish that a shipped UI currently exposes them.

The main transition hazards to check in future changes are stale async completions after project/window changes, cancellation before resource acquisition finishes, shutdown before writes drain, publication before verification/persistence, and duplicated UI/ref state. The report identifies where the code handles those concerns; it does not claim that each hazard is currently reproducible.
