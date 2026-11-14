# Plan: make the five highest-priority state machines explicit

Date: 2026-11-14. Status: implemented and reviewed (stages 0-5) in the working tree, uncommitted. See [Implementation status](#implementation-status) and [Review follow-up](#review-follow-up-2026-11-14).

The scope comes from the [state-machine inventory](C:/sharull/coding/personal/side-cut/docs/implicit-state-machines.md): project sessions, export delivery, native recording ownership, studio capture, and renderer requests.

The intended outcome is that each workflow has one authoritative state, named events, checked transitions, and explicit ownership of its resources. Preserve the current public methods, renderer/host protocols, saved project formats, journal formats, and recovery behavior. These are planning assumptions, rather than new product requirements.

## Approach

Use local TypeScript discriminated unions and transition functions, with the existing classes owning asynchronous effects. Keep related machines together in their existing layer. Do not introduce a global application machine or generic workflow engine.

Two alternatives considered:

- **Statechart runtime such as XState:** good hierarchical/parallel modeling, tooling and visualization, but adds a dependency and requires adapting current classes, subscriptions and persisted recovery paths. Reconsider if local transition code begins duplicating substantial scheduling or actor machinery.
- **Status enums plus existing flags:** smaller initial diff, but leaves the same legal-state and resource-ownership rules distributed across flags. This does not fully meet the goal.

The recommended local approach fits the current code. Its cost is that transition tables and tests must make the graph visible without a runtime visualizer.

## Rules for every migration

1. Define state, event, transition and resource ownership before moving effects.
2. Distinguish requests from completions. Enter starting/stopping/closing synchronously before awaiting work, so another caller sees the operation already in progress.
3. Put handles required by a state in that state's data. For example, recording carries its recorder; retaining a take carries its file and URL. A collection of unrelated optional fields is not a substitute.
4. Every async completion carries the identity of its owner and attempt. Project epoch, document identity, request ID and attempt ID have different meanings; do not replace all of them with one global counter.
5. Ignore stale completions and dispose any resources they return. Reject invalid public commands with the existing error convention. Treat impossible internal transitions as errors; do not silently accept them.
6. Transition before notifying subscribers or executing effects. Effects may synchronously trigger callbacks or subscriber reentrancy.
7. A cancellation request does not mean cleanup has finished. Keep draining/finalizing states until the corresponding promise settles.
8. Derive legacy snapshot fields and UI booleans from machine state. Delete their independent setters when a migration is complete.
9. Preserve existing persistence ordering and recovery records. A new internal phase does not require a new on-disk status.
10. Test event sequences and observable effects: results, released resources, persisted records, and rejected commands.

A local machine can expose a transition function shaped like `transition(state, event) -> { state, effects }`, with a module-specific effect union. Use it where useful; do not build a reusable interpreter in advance. Async effects live in the existing owner class and feed completion events back into the same transition path. Effect execution must retain existing serial queues and concurrency limits.

## Delivery order

| Stage | Work                                                         | Reason                                                                  |
| ----- | ------------------------------------------------------------ | ----------------------------------------------------------------------- |
| 0     | Characterize behavior and write per-module transition tables | Establish the behavior that migration must preserve                     |
| 1     | Renderer requests                                            | Small lifecycle with clear cancellation and exactly-once settlement     |
| 2     | Studio recording and retained takes                          | Make async setup and stop-to-take handoff explicit                      |
| 3     | Export queue and delivery phases                             | Preserve the strongest existing race/recovery coverage                  |
| 4     | Native recorder ownership and process lifecycle              | Separate authorization, execution and recovery                          |
| 5     | Browser project session                                      | Integrate the broadest lifecycle after the local pattern is established |

These are reviewable stages, not one large change. Stages 1–4 do not depend on each other's new internals. Stage 5 can use their existing public methods throughout.

## Stage 0: characterize and agree on semantics

For each stage, complete its transition table immediately before implementation. List every public command and async callback, the allowed source states, its destination, and cleanup on failure.

Extend existing interface-level tests where they cover the behavior. Add focused tests for missing race cases using deferred promises and fake timers; do not copy all existing scenarios into reducer tests.

Record intentional behavior changes separately. Closing during startup, issuing stop twice, retrying while old work drains, and starting after close need explicit policies. Preserve characterized behavior unless a change is approved as part of the implementation scope.

Completion criteria: every existing flag in the target workflow is assigned to a state, derived selector, independent parallel machine, or ordinary data field. Every owned timer, listener, stream, process, lock and temporary output has a documented release transition.

## Stage 1: renderer request/reply lifecycle

**Current owner:** [renderer-service.ts](C:/sharull/coding/personal/side-cut/apps/desktop/src/main/renderer-service.ts).

**Proposed files:** add sibling `renderer-request-state.ts` and `renderer-service.test.ts`; retain IPC registration and window selection in renderer-service.ts.

Separate service availability (`open | closing | closed`) and renderer readiness from each request:

| Request state   | Event                                                 | Result                                       |
| --------------- | ----------------------------------------------------- | -------------------------------------------- |
| pending         | valid reply                                           | settled success or existing structured error |
| pending         | project generation/revision invalid                   | settled stale-project error                  |
| pending         | abort / deadline / renderer destroyed / service close | settled cancellation or unavailable error    |
| settled/removed | late reply, progress or repeated cancellation         | ignored                                      |

A pending request owns sender ID, captured generation/revision, operation, completion callbacks, deadline and cleanup handlers. Terminal request state is short-lived; remove it from the pending Map after settlement, without adding unbounded history.

Implementation steps:

1. Move reply-validation policy into a named function, preserving the current exceptions for mutating operations, wait and transcribe.
2. Route all completion paths through one settlement transition.
3. Remove the request from pending before invoking external callbacks; clear its timer and listeners exactly once.
4. Preserve request limits, concurrency exceptions, progress routing, error codes, and timeout calculation.
5. Make close reject new requests and settle pending requests. Capture current close/run behavior in Stage 0; if rejecting after close is a behavior change, include it explicitly in this stage's review.

Acceptance tests: reply and abort racing; timeout followed by reply; wrong sender; duplicate reply; old project generation; revision-sensitive versus exempt operations; destroyed renderer; close with pending requests. Each promise settles once and leaves no pending timer/listener.

## Stage 2: studio capture and unsaved output

**Current owners:** [studio-panel.tsx](C:/sharull/coding/personal/side-cut/apps/web/src/modules/studio/studio-panel.tsx) and [studio-dialog.tsx](C:/sharull/coding/personal/side-cut/apps/web/src/modules/studio/studio-dialog.tsx).

**Proposed files:** a browser-specific `studio-capture.ts` controller and its tests beside studio-panel.tsx. Keep scene editing and layout in React.

Program capture states:

```text
idle -> starting -> recording -> stopping -> retained -> importing -> idle
             \-> failed             \-> failed             \-> retained (import failed)
retained -> idle (discard)
any live state -> closing -> closed
```

This is a proposed graph: an encoder error with usable recorded bytes must preserve those bytes as a retained take with an error notice, matching the current recovery intent. Define failed as having no usable take; avoid a failed state that hides downloadable output.

A retained take owns its File and object URL. Starting owns an attempt ID and cancellation lifetime. Recording/stopping own the recorder, chunks, byte count and event handlers. Import failure retains the take for retry.

Recent clips remain a parallel workflow: `disarmed | arming | armed | stopping | failed | closed`. Clip saving has its own `idle | saving | retained | importing` dimension. Reuse RecentClips for buffer ownership; do not replace it with the program recorder machine or duplicate its internals.

Implementation steps:

1. Move program recording and take lifetime out of React callbacks into the controller.
2. Enter starting before programStream() awaits mixer setup; reject duplicate starts.
3. Keep stopping active until onstop has processed the final chunks.
4. If acquisition finishes after close, dispose the acquired resources through their actual owner. Program output/mixer own shared source streams; the capture controller must not stop shared tracks still used by recent clips.
5. Derive buttons, retained-output views, beforeunload and dialog close blocking from capture state.
6. Make the close policy explicit: user close stays blocked while output needs resolution; forced unmount tears down safely. Include starting, stopping and importing in the reviewed close policy.

Acceptance tests: rapid double start; unmount while awaiting mixer; stop twice; final data event before onstop; encoder failure with/without chunks; failed import retains download; discard revokes one URL; program recording and recent clips coexist. Use the existing verify:studio-ui and verify:live-studio flows for runtime verification after implementation.

## Stage 3: export ownership, execution and publication

**Current owner:** [export-queue.ts](C:/sharull/coding/personal/side-cut/packages/platform-browser/src/export-queue.ts).

**Proposed files:** local `export-queue-state.ts` and `export-job-state.ts`, with existing queue tests extended.

Keep two machines:

- Queue lifetime: `unconfigured | acquiring | recovering | ready | blocked | closing | closed`. Active execution and in-flight serialized operations are owned work that must drain, not competing lifetime flags.
- Job lifetime: `staging | queued | rendering | storing | committing | done | cancelling | cancelled | interrupted | failed | removing`.

The internal phases project onto the existing ExportEntry/Delivery statuses. In particular, storing/committing continue to persist the appropriate existing running record until the final done write. Keep the durable/non-durable distinction explicit in owner data.

Implementation steps:

1. Replace running/stopping/blocked combinations with queue state and a single active attempt.
2. Define events for recipe staged, render completed, output stored, journal committed, cancellation, retry, removal and effect failure.
3. Preserve per-ID serialization; carry attempt identity so an old cancellation cannot settle a retried attempt.
4. Treat removal as cancellation plus ordered journal/resource deletion. Old callbacks cannot reinsert an entry or record.
5. Preserve recovery: running becomes interrupted; interrupted output may become done only after it is available and the journal update succeeds.
6. Release queue ownership only after active execution, staging effects and persistence/removal operations have drained. Audit each category instead of relying on one map's size.
7. Keep output URL and Blob release ownership explicit until removal/close under the existing retention policy.

Acceptance tests: retain all existing export-queue tests, particularly late staging/removal, late output storage, immediate retry during staging, cross-window ownership and recovery without rerendering. Add close during acquisition/recovery and cancellation during output commit. A recovered done export has accessible output; removed work never reappears; locks release only after owned work drains.

## Stage 4: native recorder ownership and lifecycle

**Current owners:** [native-recorder.ts](C:/sharull/coding/personal/side-cut/apps/desktop/src/main/native-recorder.ts), [native-recorder-ipc.ts](C:/sharull/coding/personal/side-cut/apps/desktop/src/main/native-recorder-ipc.ts), and [capture-permissions.ts](C:/sharull/coding/personal/side-cut/apps/desktop/src/main/capture-permissions.ts).

Implement this as two changes so authorization and media processing can be reviewed separately.

**4A — document ownership and permission grants**

- Recorder owner: `unowned | confirming | starting | active | stopping | invalidating`.
- Browser capture grant: `awaitingApproval | approved | selectingDisplay | displayGranted | revoked`, with source kind and expiry as data.
- Retain sender/frame identity, approval checks and trust validation in Electron.
- Navigation/destruction invalidates the current attempt immediately; any late start must stop only the recording it created.
- Preserve different capabilities for screen/camera/microphone and the screen-before-microphone requirement. This is not a merge of native recording permission and browser capture permission.

**4B — recorder process and saved recording**

- Service lifetime: `initializing | open | closing | closed`.
- Active operation: `idle | starting | recording | stopping | finalizing | operatingOnSaved`.
- Persisted NativeRecording status remains its existing independent contract.
- Process handles and exit completion belong to the active attempt; saved-media operations own their exclusive operation slot.
- Stop and unexpected process exit converge on one finalization path. Publication/recovery still validates retained files before exposing ready.
- Streaming target health stays independent of local recording status; a failed network destination must retain the existing local-recording behavior.

Acceptance tests: keep the real FFmpeg recording/remux/recovery suite and IPC trust/navigation tests. Add approval resolved after navigation, destruction while start awaits, concurrent stop and process exit, close during finalization and saved-recording operation conflicts. Unsupported journal versions and failed remux source files remain intact.

## Stage 5: browser project session

**Current owners:** [browser-session.ts](C:/sharull/coding/personal/side-cut/apps/web/src/modules/workspace/browser-session.ts), [host-coordinator.ts](C:/sharull/coding/personal/side-cut/apps/web/src/modules/workspace/host-coordinator.ts), and [save-queue.ts](C:/sharull/coding/personal/side-cut/packages/platform-browser/src/save-queue.ts).

**Proposed file:** `project-session-state.ts` beside browser-session.ts. Retain BrowserProjectSession as the public interface.

Use an outer lifecycle union:

- `closed`: no attached session resources.
- `opening`: current epoch and acquisition lifetime.
- `open`: attached project, explicit backend and operation/persistence state.
- `closing`: invalidated epoch and captured resources still draining.
- `failed`: startup failure plus any retained original/recovery information.

Within open, use explicit variants for `browserWriter`, `browserFollower`, `nativeHost`, and `unsupported`. A writer carries its lock and SaveQueue; a follower carries refresh capability; nativeHost carries HostCoordinator and host generation. Host attachment is not a browser Web Lock.

Keep orthogonal state local to the open session:

- Persistence: saved/saving/error with the last successful revision and latest pending save identity.
- Foreground operation: idle or a named import/relink/archive/replace/export/resource operation with its token and cleanup owner.
- Unsupported original data belongs to the unsupported variant, rather than an optional string plus unrelated writable flags.
- Long-lived jobs and queued exports retain their own machines and lifetimes.

Implementation steps:

1. Derive BrowserSnapshot.saveState, readOnly, busy, error and unsupportedJSON from the new state, preserving their current consumer contract. Preserve distinct startup, save and operation errors internally.
2. Audit every call to update(), assertWritable(), start(), attach(), attachHost() and close(). Build an operation table from actual callers before replacing busy.
3. Centralize begin/finish/fail for foreground operations. A completion must match the operation token and session epoch.
4. Make opening acquire resources into an owned scope; installation or cleanup consumes that scope exactly once.
5. Invalidate the epoch before awaiting close. Capture the old resources for draining; never let an old close clear a newly opened session.
6. Preserve save-before-release, follower broadcasts, unsupported-original retention and host generation synchronization.
7. Keep the existing side effect that stops/discards recording on loss of write access or project ownership, but trigger it from the named transition.
8. Remove legacy flags and scattered snapshot patches only after every producer routes through events.

Acceptance tests: startup resolution after close/reopen; read-only follower takeover; failed save then retry; closing waits for save before releasing lock; stale operation completion after project replacement; host generation changes; unsupported project download/recovery; folder imports waiting on foreground work; two stale completions cannot clear a newer busy operation.

## Validation and completion criteria

For each stage:

- Run its focused tests, typecheck and lint before runtime checks.
- Run the repository check command, `pnpm exec vp run check`, before merging the stage.
- Run relevant existing browser/desktop verification scripts after changes to runtime effects: studio UI/live studio, capture/native recording, delivery/recovery, and browser/storage flows as applicable. Run real FFmpeg tests on a machine with the required binaries.
- Document a behavior change if a newly explicit guard alters an existing interaction. Never silently call a changed policy a refactor.
- Review resource cleanup, public snapshot compatibility and persisted-record compatibility.

A stage is complete when events are the only way to change its authoritative lifecycle state, its old flags are removed or derived, race tests verify resource/result behavior, and existing consumers use the same public interface.

The plan itself was written without any installation, refactor, migration, commit or runtime test; implementation and validation are recorded below.

## Implementation status

Implemented on 2026-11-14 in the shared checkout, uncommitted, with no new dependency and no persistence or protocol change. Each module is a local discriminated union with a pure transition function (stale events return the same state; invalid public commands throw the existing error text); the owning class keeps the asynchronous effects. The old independent lifecycle flags were removed or became derived selectors.

| Stage | New module (pure transitions)                                                    | Authoritative state replaces                                                                                                                                                                                                      | Tests                                                                                                            |
| ----- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 1     | `apps/desktop/src/main/renderer-request-state.ts`                                | per-request `finish`/`cancel`/`closed` closures and ad hoc reply validation in `renderer-service.ts`                                                                                                                              | `renderer-service.test.ts` (new, 7)                                                                              |
| 2     | `apps/web/src/modules/studio/studio-capture.ts` (`StudioCapture`, `ClipCapture`) | `recording`/`take`/`armed`/`saving`/`clip` React state, recorder ref and recorder callbacks in `studio-panel.tsx`                                                                                                                 | `studio-capture.test.ts` (new, 16)                                                                               |
| 3     | `packages/platform-browser/src/export-queue-state.ts`                            | `running`/`stopping`/`blocked`/`releaseWriter` flags, controller-per-task and entry-status updates in `export-queue.ts`                                                                                                           | existing 10 plus 5 added in `export-queue.test.ts`, and `export-queue-state.test.ts` (new, 3)                    |
| 4A    | `capture-grant-state.ts`, `native-recorder-owner-state.ts`                       | `approved`/`expires`/`displayPending`/`displayGranted` grant flags; owner `invalid`/`started`/`stopping`/`id`                                                                                                                     | 2 added in `native-recorder-ipc.test.ts`; `native-recorder-owner-state.test.ts` (new, 3)                         |
| 4B    | `native-recorder-state.ts`                                                       | `busy`/`closed`/`session`/`initialized`, session `child`/`done`/`stopping`                                                                                                                                                        | 4 real-FFmpeg tests added to `native-recorder.test.ts`; `native-recorder-state.test.ts` (new, 3)                 |
| 5     | `apps/web/src/modules/workspace/project-session-state.ts`                        | the snapshot fields `saveState`/`readOnly`/`busy`/`error`/`unsupportedJSON` plus `store`/`release`/`queue`/`channel`/`unsubscribe`/`epoch`/`archivedRaw`/`hostGeneration`/`folderStop`/`exportController` in `browser-session.ts` | 4 added in `browser-session.test.ts`; `project-session-state.test.ts` (new, 15); 1 added in `save-queue.test.ts` |

### Where each rule from this plan landed

- **Stage 0 (tables)** are the header comments of each state module plus its `*Event` union; behavior was characterized by the existing suites (export queue, browser session, native recorder with real FFmpeg, IPC trust/navigation) before each change and those suites still pass unmodified.
- **Stage 1.** `RequestState = pending | settled`; `requestTransition` is the only settlement path (reply, abort, deadline, destroyed, close). The request leaves `pending` and its timer and listeners are released before the promise is settled; the renderer is told to cancel only for abort/deadline. Service availability is `open -> closing -> closed`.
- **Stage 2.** `StudioCapture`: `idle|failed -> starting -> recording -> stopping -> retained -> importing -> idle`, `closing -> closed`. `ClipCapture` has independent `buffer` (`disarmed|arming|armed|stopping|failed|closed`) and `product` (`none|saving|retained|importing|closed`) dimensions and reuses `RecentClips`. Controllers own take Files and object URLs (revoked exactly once) and never stop shared source tracks. The panel reads state through `useSyncExternalStore`; `onBusy`, `beforeunload`, buttons and the retained views derive from it.
- **Stage 3.** Queue lifetime `unconfigured|acquiring|recovering|ready|blocked|closing|closed` returns the lock `release` handle from a transition exactly once, after active execution, staging and journal operations drained. Job lifetime `queued|starting|rendering|storing|committing|cancelling|done|cancelled|interrupted|failed` carries an attempt number and controller; completions for another attempt or a removed job are stale and release their output. `ExportEntry` statuses are projected from it; journal write ordering is unchanged.
- **Stage 4A.** Owner `confirming|starting|active|stopping|invalidating` (a late start for an invalidated owner stops only the recording it created). Grant `awaitingApproval|approved|selectingDisplay|displayGranted|displayDenied|revoked`.
- **Stage 4B.** Lifetime `open|closing|closed`; journal recovery `pending|running|done|failed` (cached as before); operation `idle|preparing|starting|recording|stopping|finalizing|operatingOnSaved`. The process handle exists only in the states that need it. An unexpected process exit and an explicit stop reach the same release path; whichever transition happens first wins and the other is stale. Stream target health stays inside the session.
- **Stage 5.** `opening|open|closing|closed|failed`; `open` carries the store, channel, explicit backend (`browserWriter` with lock and SaveQueue, `browserFollower`, `unsupported` with the original JSON, `nativeHost` with HostCoordinator, generation and folder watch), persistence, a single error slot with its source (`save|host|operation|background`) and the foreground operation (name, token, optional abort controller). `BrowserSnapshot` lifecycle fields come only from `deriveStatus`; `update()` can no longer set them. `begin`/`finish` pairs replaced every `busy` toggle. `close()` invalidates the epoch before awaiting and drains only the resources it captured. Persistence also carries `saves` (last durable revision, latest pending save identity, host generation), updated by `saveRecorded`/`hostStatus` events whose backend and epoch must still match. Stop/discard of capture runs from `guardCapture` after ownership/backend/epoch transitions and project/data updates.

### Intentional behavior changes and deviations

These are the cases where a newly explicit guard differs from the previous behavior or from the proposed graph; nothing else is intended to change.

1. **Renderer service:** after `close()` a new `run()` rejects with the existing "unavailable" error (it could previously still be sent to a window whose reply handler was already removed).
2. **Studio close policy:** user close (dialog) and `beforeunload` are now blocked in `starting`, `recording`, `stopping`, `retained` and `importing`, and while a clip is `saving`, `retained` or `importing`. Forced unmount aborts a clip save, stops the recorder and discards the unsaved take, revoking its URL; previously the late `onstop` could publish a take and URL after unmount. Take and clip actions are disabled while an import is in flight (the old closure could revoke the wrong URL after a concurrent save). A clip save is refused while that clip is importing.
3. **Studio clips:** `RecentClips` raises no event when its source ends, so the `failed` buffer state is detected lazily (on mark, save, or toggle) rather than immediately. Program recording with no recorded bytes after an encoder error is `failed` with the encoder message; with bytes it is retained with the failure notice.
4. **Export queue:** `configure()` is single-flight (a concurrent second call waits instead of racing a second lock acquisition). `stop()` during lock acquisition releases the lock when it arrives; `stop()` during recovery keeps the lock until recovery drains. The queue is still re-configurable after `closed`, as before. Recipe staging remains an owned effect (the `pending` promise) rather than a job state, because a staging job is already shown and cancelled as `queued`; removal is represented by deleting the job instead of a `removing` state.
5. **Native recorder:** a `stop()` that arrives while an unexpected-exit finalization is writing its journal now rejects with "No active recording" (previously it could proceed against a dead process). `close()` still stops a live recording and waits for any in-flight operation, then refuses new work.
6. **Browser session:** a startup failure after the session is installed, a `start()` over an open session, and a failed `enableEditing` after installation now retire the resources the machine owns (subscriptions, channel, lock, store) exactly once; before, some were released twice or not at all. A read-only session that holds unsupported original data is never refreshed into a follower. The shared error slot keeps the earlier "last writer wins" behavior but now records its source; save state changes and operation starts still clear it.

### Known limitations

- Persistence identity is tracked per backend, not persisted: the browser writer records the last durable revision and the newest pending save from `SaveQueue`'s new optional `onSave` callback (which also reports older saves that settle under newer pending/failed work); the native host records it from `HostSnapshot` sequence/generation/revision. `SaveQueue`'s `onState` contract and the host wire protocol are unchanged, and the data is exposed only through `BrowserProjectSession.saveProgress()`, not `BrowserSnapshot`. The native host can only report the status of its latest snapshot, so it cannot reveal older host saves that finished earlier.
- Capture ownership is now an effect of named transitions (`captureTransition`, run from `transition()` for ownership/backend/epoch changes and from `update()` for project/data changes); `publish()` only derives and notifies. A given recording snapshot is acted on once. The session's own `recording.close()` during `close()` remains a separate, existing discard.
- There is no DOM/React test environment in the repository, so the studio panel wiring is covered by the controller tests and by the `verify:studio-ui` browser run rather than component tests.
- Not run: `verify:packaged`, `verify:windows-install`, `verify:native-long-run`, `verify:long-delivery`, the cloud/Convex flows, and physical capture (the desktop capture and native-recording scripts use synthetic devices).

### Review follow-up (2026-11-14)

Reviewed the state-machine changes against HEAD, including untracked source and tests, along correctness/ownership and plan-completeness axes. Unrelated environment, package, cloud and landing edits were excluded. The review found real defects; the earlier passing suite did not establish completion by itself.

The following fixes are now part of the implementation:

- **Studio:** acquisition rechecks the live attempt after notifying subscribers, so a synchronous close or stop cannot start an orphan recorder. Replacement-save teardown releases both the previous clip and any late result. Repeated clip close calls wait for the same buffer cleanup and retain `stopping` until it finishes. Clip buffer/product changes now use named events and a pure `clipsTransition`; recorder-start failure also goes through a named event.
- **Session ownership:** restart and post-install failure detach subscriptions immediately, drain pending saves, then close the broadcast channel, release the writer and close storage. A later start and repeated closes wait for that drain. Keeping the channel until saves finish preserves the final follower notification. Restart/failure abort owned foreground work. Startup checks its epoch after media refresh and storage acquisition before configuring exports, preventing a closed session from reacquiring the delivery lock.
- **Session recovery/status:** closed snapshots report the final save outcome instead of remaining `saving`. Failure retains unsupported original JSON in state, and `downloadProject()` uses that retained original. Recovery warnings and project data remain in the session data snapshot.
- **Renderer requests:** send and reply-position failures settle through the request machine and release their timer, listeners and concurrency slot. Cancellation transport failure cannot prevent promise settlement. Reply serialization/size failures use the same settlement path.
- **Native recorder:** shutdown drains an operation even when stop fails, reaches `closed`, then propagates the original failure. Real-FFmpeg coverage includes unexpected exit followed by stop and successful slot reuse, in addition to the existing concurrent-stop and close-during-finalization tests.
- **Queue/persistence:** reconfiguring without Web Locks uses the newly supplied storage options. Removed jobs release their pending-promise entries. Exceptions from the new save-identity observer cannot change a durable write's outcome or block later writes. The save queue installs each write before notifying observers, so a synchronous flush includes the save that triggered its notification.

Additional owner-level tests cover restart with pending saves, repeated close, late export-storage acquisition after close, unsupported-original download after failure, host generation cancellation and stale completion, folder imports waiting for foreground work, renderer cancellation/errors/concurrency/progress, and queue storage reconfiguration. Existing tests already cover approval resolved after navigation, follower takeover, unsupported imports, unsupported native journals and failed-remux source retention; these were checked rather than duplicated.

One conditional review concern was ruled out from callers: `StudioPanel` freezes its project ID, its session comes from a stable `useState` provider, and the app does not enable StrictMode. Its controller-closing effect therefore does not rerun with a different session during the current product flow. React development effect replay is not covered by a component test.

The implementation policies additionally make rearming recent clips wait for an active save, make session restart wait for old saves, and leave the recorder terminally closed after a shutdown error. These are intentional lifecycle guards. The earlier documented staging/removal representation, shared error slot, lazy clip-source failure detection and host snapshot observability limits remain deliberate deviations; the remaining inventory workflows are outside this plan's five priorities.

Review outcome: no outstanding documented-standard findings and no blocking plan-completeness findings after these fixes. The limitations and deliberate deviations above remain explicit. The two reviews were run independently with `claude_personal/claude-sonnet-5-5` at medium effort; findings were checked against actual callers and regression tests before fixes were accepted.

### Validation (Windows, 2026-11-14)

- **Final repository check:** `pnpm exec vp run check` passed, 21/21 tasks: whole-repository formatting, lint with `--deny-warnings`, all workspace typechecks, and **158 files / 820 tests**, including real FFmpeg. Earlier implementation checkpoints were 789 and 801 tests.
- **Runtime rerun during review:** production web and desktop builds passed. `verify:studio-ui` passed (close guard, recording with audio, take handoff, recent clips, reload recovery); `verify:native-recording` passed its final recovery stage; `verify:delivery-recovery` passed rendering interruption, native encoding interruption and publication recovery. Chromium and Firefox passed the browser import/edit/save/reopen/export/archive journey. Chromium was also rerun against the final web build after the save-queue notification-order fix.
- **WebKit limitation:** the full browser script exits nonzero for WebKit in this Windows environment. The current run failed opening SQLite/OPFS storage and timed out waiting for the project; `VideoEncoder`, `AudioEncoder` and `AudioBuffer` are also unavailable. The earlier implementation run reproduced the WebKit failure against the original session source. This remains an environment/browser validation failure, not a passing check.
- **Earlier runtime coverage:** `verify:live-studio`, `verify:recent-clips`, `verify:recording` and `verify:capture-desktop` passed during implementation; these were not all rerun during this review. The long-run, packaged, cloud and physical-device checks listed above remain unrun.
- The verification scripts rewrite files under `docs/verification/`; review runs restored those files from a pre-run backup, preserving their prior contents.
