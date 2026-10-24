# Filmora finishing and project queries

Subphases 118.08, 118.09 and 120.01–120.03 were verified on Windows on 2026-10-24.
The baseline is Tandem commit `735a9b8e162c1f951044baa892d94993869f2e77`.
The implementation ports the reference's mapping and formatting rules into the
existing importer, coordinator and host/renderer service.

## Filmora transitions

`filmora-transitions.ts` maps transition names, directions and placement. Known
cut-slide, push, dissolve and fade-black variants retain their reference types.
Unknown names and approximate zooms report the replacement. Audio transitions
become crossfades. Inclusive Filmora ticks become exclusive ranges.

An edge spanning a cut joins adjacent clips once. Off-centre cuts are centred
with a report. Transitions shorten to available source handles and clip lengths,
rounded down to whole frames. Cuts with insufficient handles and transitions
into still images are omitted with a warning. Head/tail durations cannot exceed
their clip. Invalid transition ticks reject the import.

## Titles and nested templates

`filmora-templates.ts` maps title text, font/weight, colours/alpha, stroke, shadow,
background, alignment, position, rotation and estimated box sizing. In/out
animation names and timing are preserved through supported aliases. Placeholders,
caption timing loss and unsupported effects/animations produce notes. For
example, `slideDown` remains in the project with a warning because the current
SideCut renderer does not draw it.

Template and compound timelines flatten into the parent track's visible window.
Source offsets account for trimming and speed. Overlapping layers reuse extra
lanes, and title/media positions inherit static parent position/scale. Template
sound is placed once on a Template sounds track even when Filmora also has a
type-16 sound wrapper. Parent transitions attach to layers at the visible edges.
Flattened children retain template tags and do not acquire unrelated take links.
Unreadable/deep templates are reported; depth is bounded to four levels and
expanded input to 10,000 clips. Invalid title JSON rejects the import.

## Status and review

Status retains the host's project revision, saved revision, dirty state, counts,
undo/redo labels and owner PID/start/port. It reads renderer analysis jobs, UI
export queue entries and installed/bundled font availability through a validated
query snapshot. Project ID, revision and host generation must still match when
the renderer replies. Missing or malformed snapshots are not accepted as current
state. Without a ready renderer, the host returns its project state and an
explicit warning about unavailable renderer information.

Pending agent reviews derive from validated journal edits, in order, with their
labels, authors, recorded dates, surviving changed clip IDs and removal counts.
Reading status does not acknowledge them. A trusted editor action marks the
current saved revision reviewed; its baseline is stored separately in SQLite
preferences. It does not change the project JSON, revision or undo history and
is not exposed as an HTTP/CLI operation. The editor disables acknowledgment until
saving finishes. Stale acknowledgments reject. Restart preserves the baseline;
recovering a project older than its baseline conservatively reopens review.
Older journal entries without dates remain undated rather than receiving an
invented timestamp.

## Timeline

`timeline-dump.ts` implements the reference text structure, aligned IDs and
lengths, top-to-bottom track order, markers/notes, cut-track gaps, link numbering,
non-default settings, transitions/sounds and used-media footer. Settings shared
by at least 60 percent of four or more clips move to the track header; exceptions
remain on clip lines. Text style fields and animation paths remain inspectable.
Summary output reports each track's full span, unioned content duration, gaps and
transitions. As upstream does, summary ignores the requested range.

JSON range queries retain full overlapping clips and only transitions whose
referenced clips remain. Marker spans use half-open overlap. Words come from the
same cached transcript and waveform-alignment path as editor speech queries,
mapped into clip clocks. Range output marks shortened text with ellipses and
reports missing transcripts once. These queries do not edit the project. The
query time parser accepts seconds, `s` suffixes and up to three clock fields;
malformed fields and reversed ranges reject.

## Media

Media combines host metadata/usage and safely scoped disk existence with the
renderer resource store and applicable cache/job states. A copied source can be
available even when the original path is missing. Actual cached transcripts,
waveforms, thumbnails, proxies, mattes and loudness measurements report ready;
queued/running/failed/cancelled analyses retain state and relevant progress/error.
Cache readiness takes precedence over an old job result. Job kinds that do not
apply to the source are omitted. No analysis/provider model is downloaded by the
snapshot query.

Existing refresh still probes and commits one revision-checked batch through the
host authority. Failed, cancelled or stale scans do not partially import; undo
removes the added media. Read queries can share the renderer bridge with another
operation, within a bound of eight pending requests. Mutating/render operations
retain their existing serialization.

## Evidence and reproduction

`vp run check` passes formatting, lint, TypeScript and 390 tests in 80 files.
`vp run build:desktop` builds the production SPA and Electron bundles.

- `filmora.test.ts` covers each transition mapping, handle limits, edge/cut
  deduplication, approximation/failure cases, titles, nested windows/transforms,
  sound deduplication, recursion limits and malformed title input.
- `timeline-dump.test.ts` checks readable settings, summaries, gaps, transitions,
  range filtering, words/missing data, empty tracks and time validation.
- `query-state.test.ts` uses the real SQLite-backed host and checks renderer
  boundary validation, stale/cancelled queries, copied-source state and review
  persistence. Existing HTTP tests retain atomic refresh/undo/failure coverage.

The [runtime report](finishing-runtime.json) records successful fixture import and
SQLite reload in Chromium, Firefox and Windows Electron. Screenshots show
[Chromium](finishing-chromium.png), [Firefox](finishing-firefox.png) and
[Electron](finishing-electron.png).

The Electron HTTP journey additionally checks owner and font warnings, a copied
audio source, a real cached transcript, readable words, summary/range JSON and
concurrent read queries at the shared revision. A real UI WAV export populates
status and the loudness cache. An HTTP agent edit appears in pending review;
status reads retain it, and the UI acknowledgment clears it across reload without
changing the revision. See [the query capture](finishing-queries.png).

Browser checks use actual project downloads. Electron captures the JSON Blob
generated by the Download project button because the Playwright Electron download
event did not fire on this host. The shared T3 preview had already timed out twice
with `Preview automation snapshot timed out after 15000ms.` Verification follows
the repository's Playwright workflow.

```powershell
vp run check
vp run build:desktop

# In a separate terminal, from apps/web:
vp dev --host 127.0.0.1 --port 4270 --strictPort

# From the repository root:
vp run verify:finishing
```

The verifier uses disposable folders, browser contexts and an Electron profile,
then removes its temporary files. It does not use the normal app profile.

## Limits

Evidence is synthetic and source-derived. A real Filmora installation, macOS
Tandem round trip and reference pixel/audio goldens were not run. Parent template
rotation, opacity, effects and animation are reported without applying them to
flattened children. Titles retain the existing font/animation renderer limits.
Reverse/freeze, exact speed ramps and unsupported effects keep their earlier gaps.

The browser's converted-media and isolated-voice caches do not have equivalents
to Tandem's persistent native analyses; those applicable states remain none.
Export status describes the session's UI queue, which is not persisted across
app restart. Native source refresh still requires a selected watched folder and
does not silently read outside it. No macOS/Linux installer, WebKit/Safari, model
quality benchmark, public hosted deployment or paid-provider acceptance ran.
Full Tandem compatibility is not claimed. Clips subphase 120.04 is next.

Ported code retains the [upstream MIT notice](../../tests/fixtures/tandem/TANDEM-LICENSE).
