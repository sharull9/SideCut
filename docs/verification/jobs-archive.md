# Comments, sync, watch, wait and archive verification

Verified on Windows Electron on 2026-10-25. This covers subphases 126.03,
127.01–127.03 and 128.01, superseding their baseline gaps in
[phases 126–130](phases-126-130.md). Native macOS/Linux comparison remains open.

The reference is Tandem revision `735a9b8e162c1f951044baa892d94993869f2e77`.
`tests/fixtures/tandem/jobs-archive.json` records source files, request cases and
defaults. These are synthetic contracts transcribed from source, rather than
captured Swift responses. The original license remains in the fixture directory.

## Supported behavior

`comments` includes cached speech within four seconds either side of each marker,
with `|` at the marker. Clips appear in display order: top video first, then
audio from the top, using half-open timeline ranges. Missing transcripts omit
`said`. Listing is read-only; resolution uses `removeMarker` in the same shared
apply batch as its edit. Existing durable human review and activity controls
remain in use.

`sync` accepts signed picture delays within one second, skips recorder-corrected
cameras by default, and avoids no-op edits. `makeDefault` persists in SQLite
preferences and applies when new camera sources enter the host coordinator.
Dry runs preserve both project and preference. Sound matching resolves media IDs,
clip IDs or paths, chooses a unique placed camera unless `to` names the reference,
and refuses self-matches or sources without sound. The existing worker measures
offsets. A validated plan sets take offsets, shifts the origin when needed,
reclassifies external voice sources and uses `placeSynced` unless `place:false`.
Existing clips retain their placement. The plan commits as one revision and one
undo step, with stale-revision protection after analysis.

`watch` returns edit, undo, redo and reload events newer than the requested
revision. Events have process-local sequence numbers, dates, labels and authors.
The host retains 512 change events independently of renderer job progress.
Reconnects replay those events; generation changes, restarts and expired replay
coverage set `resync` when a fresh snapshot is needed. The default timeout is
30 seconds, clamped to zero through 600. Responses include current renderer jobs.
Cancelling the long poll removes its subscription.

`wait` supports jobs, transcript, matte, proxy and export. It resolves media and
clip/path aliases, validates all targets, loads cached states and schedules the
supported missing transcript/cutout/proxy work. An explicitly selected source with
no applicable need or cached result fails with an explanation. Results contain
`finished`, `pending`, `done`, `timedOut` and elapsed seconds. The default timeout
is 600 seconds, clamped to zero through 86,400. A zero-second wait returns current
state. Cancellation and timeout leave analysis jobs running; project replacement
rejects the wait. API renders and UI export queues are observable. Legacy job
`items` remain available.

`archive` without `output` consolidates resources into the managed project folder.
`to` creates a standalone copy inside the requested destination, preserving the
source project. `dryRun` reports paths, hashes, byte counts and missing media
without writing files or edits. Copies reject different existing contents and can
reuse identical resources. Copy mode stages and publishes the folder atomically;
cancellation removes its temporary folder. Consolidation rewrites references
through one shared edit. Undo restores references and retains copies. LUT
resource keys follow their rewritten paths.

Folder archives contain `project.tandem`, a resource manifest, `archive.json`,
collected media and the `.sidecut` bundle identified by `openFile`. Consolidated
snapshot filenames use a content-derived prefix to avoid replacing host files.
Opening `openFile` restores resources through the existing project-open flow.
`withCache:true` includes available local transcript, waveform/thumbnail, matte
and PNG proxy caches. Reopening restores those caches; re-archiving with caches
disabled omits them. `output` retains the earlier ZIP export behavior. Combining
`output` with folder options is rejected.

## Evidence

Core and host tests cover comment context and boundaries, source resolution,
sync planning/placement/undo, recorder defaults, malformed requests, revision
conflicts, watch replay/timeout/cancellation, wait scheduling/failure/deadlines,
folder dry runs, missing resources, overwrite refusal, consolidation undo and
archive cancellation. The full check passes 428 tests in 87 files, formatting,
lint and all TypeScript programs. `vp run build:desktop` passes.

[The Electron runtime record](jobs-archive-runtime.json) verifies HTTP requests
against the running editor. Synthetic recordings recover a 0.2500000002-second
offset at confidence 206.16. Sync dry-run/apply/undo passes, and a comment resolves
through an edit that watch replays. A cached two-word transcript is ready; an API
audio export is observed to completion. Archive dry-run writes nothing, copy mode
preserves the source revision, consolidation undoes, and reopening restores audio
and the two cached words. Runtime also checks consolidated LUT availability and
cache omission on re-archive. See [the resulting editor](jobs-archive-editor.png).
The synthetic camera fixture carries WAV audio under camera/video metadata;
its screenshot reports no decodable picture. This runtime verifies sound and
resource behavior, rather than camera picture playback.

Reproduction uses the repository's Electron acceptance workflow:

```powershell
vp run build:desktop
vp exec --filter @sidecut/web vp dev --host 127.0.0.1 --port 4270 --strictPort
# In another terminal:
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
vp exec --filter @sidecut/desktop electron ../../tests/desktop/verify-jobs-archive.mjs
```

The script uses temporary profiles and destinations and returns a failing exit
code if an assertion fails. It makes no provider or paid generation calls.

## Compatibility limits

- Sound matching accepts known-duration sources up to 60 seconds. It measures
  one offset and does not estimate recorder clock drift. Long recordings and
  native reference audio comparisons remain unverified.
- Watch is a revision-based HTTP long poll. SSE/Last-Event-ID replay and a stream
  of export/job progress events are separate capabilities. Replay is process-local.
- Wait schedules the browser's transcript, matte and proxy implementations.
  Native converted-media and isolated-voice scheduling are not added. Proxy and
  matte processing retain their existing 60-second limits. Model downloads and
  new matte/proxy generation were not repeated in this batch; runtime uses a
  cached transcript. The 24-hour bound is tested as a configured deadline,
  rather than a 24-hour wall-clock run.
- Folder archives collect registered browser resources. The managed host profile
  contains credentials, locks and databases, so its other files are excluded and
  reported in `leftOut`. Native sibling project versions, recorder sidecars,
  installed system fonts and APFS clones are not collected. Missing-file reporting
  currently covers media. External files must first be imported or relinked.
  Opening `openFile` restores resources; opening only the raw `.tandem` file does
  not import them into browser storage.
- Archives retain a 256 MiB bound. Included caches are browser versions, rather
  than native Tandem caches. Interrupted consolidation can leave unused copies;
  the source project changes only when its edit commits.
- Packaged installations and native macOS/Linux behavior remain unverified.
