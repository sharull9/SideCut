# Tandem parity roadmap

Status: phases 001-027 and 029-042 are implemented and verified on Windows Chromium. Phase 028 is implemented and verified on localhost development and production preview servers; its public hosted-URL acceptance remains pending. See [phases 001-006](verification/phases-001-006.md), [007-012](verification/phases-007-012.md), [013-018](verification/phases-013-018.md), [019-024](verification/phases-019-024.md), [025-030](verification/phases-025-030.md), [031-036](verification/phases-031-036.md), and [037-042 evidence and limits](verification/phases-037-042.md). Later phases remain pending. Full rendering, desktop delivery, and agent tools remain planned.

## Goal and baseline

Build SideCut as a browser-first Tandem-compatible editor, with an optional Electron application for Windows, macOS, and Linux. Humans and agents must use the same editing commands and project authority. Keep media local, preserve the existing shadcn preset, and use `vp` for every development command.

This roadmap expands [the architecture plan](monorepo-plan.md). It is a delivery backlog, not a claim of compatibility or a complete technical design for every subsystem. Start with phase 001 and complete one small phase at a time. Resolve each subsystem's design choices before its implementation.

Reference revision: [`mikecann/tandem@735a9b8e162c1f951044baa892d94993869f2e77`](https://github.com/mikecann/tandem/tree/735a9b8e162c1f951044baa892d94993869f2e77), refreshed and inspected on 2026-10-21. Parity means compatibility with this revision. Later upstream changes get a separate review and backlog.

Authoritative reference files at that revision:

- `Sources/TandemCore/Model.swift`, `Time.swift`, `Commands.swift`, `Editing.swift`, and `ProjectCoordinator.swift` define project data and editing behavior.
- `Sources/TandemAPI/CommandCatalog.swift` enumerates 51 edit commands. `TandemAPI.swift` enumerates 34 project service operations. `AssetTypes.swift` adds 11 asset/segment operations. MCP exposes 43 tools, which do not map one-to-one to those operations.
- `EffectRegistry.swift` defines 15 effects. `Model.swift` defines 8 transition types.
- `Sources/TandemApp`, especially `Editor/EditorRootView.swift`, timeline interaction models, inspectors, and keymaps, define the reference interface and interactions.
- `docs/ARCHITECTURE.md`, `MEDIA.md`, `RENDER.md`, `ASSETS.md`, the agent guides, and upstream behavior tests explain edge cases. An upstream plan checkbox alone is not proof of implemented behavior.

## What counts as compatible

- Project compatibility: decode supported `.tandem` files, preserve IDs, defaults, metadata, paths, and settings, and export files Tandem can reopen. Cover schema version 2 and the older versions the reference actually migrates. Reject newer versions explicitly.
- Edit compatibility: match command arguments, defaults, validation, batch atomicity, revision checks, idempotency, links, ripple behavior, warnings, and undo results.
- Interface parity: provide equivalent editing workflows and shortcuts using SideCut's existing design system. Match behavior rather than copying macOS window chrome.
- Media parity: support the reference content types, compositing order, audio levels, transitions, titles, analysis, and exports. Record a tested tolerance where different media engines cannot produce identical pixels or samples.
- Agent compatibility: preserve the reference operation/tool names, request and result shapes, JSON/text output conventions, errors, and shared editing authority. SideCut can use its own executable name; existing scripts need an explicit compatibility launcher if they assume `tandem`.
- Platform parity: test Windows, macOS, and Linux desktop builds. Test the hosted editor separately in Chromium, Firefox, and WebKit/Safari. Build success alone does not establish editing or codec support.

Browser editing must work without an installed companion. A web page cannot independently provide stdio MCP, arbitrary folder watching, OS credential storage, or every native codec. Browser features must expose capability checks and useful alternatives. Desktop is the target for the complete native workflow. Browser limitations remain recorded gaps; they never count as completed parity.

Apple SpeechAnalyzer, Vision segmentation, and AVFoundation cannot simply be reused on all targets. Equivalent implementations need separate quality and performance checks. Exact model output is not promised. Unimplemented upstream items, including planned Remotion graphics rendering, are outside this pinned baseline; preserve their data and report unsupported rendering.

## Phase rules

- Each phase contains two small deliverables and one acceptance check. If either deliverable needs unrelated changes or several sessions, split it before starting. Do not hide several effects, endpoints, or platforms inside one task.
- Follow numeric order initially. Later independent work may proceed only after its dependencies pass. No phase is complete because a button or mock result exists.
- Add packages only with their first real consumer. Keep project logic in portable contracts/core, session coordination in client-runtime, UI in feature modules, and platform operations in adapters.
- For behavior, use small synthetic fixtures and observable assertions. Retain applicable upstream MIT notices and third-party asset licences when porting code or fixtures. Never commit private footage or credentials.
- Run relevant tests, `vp run check`, and `vp run build` for implementation changes. Use `vp fmt` to format and `vp exec` for installed tools. Add new scripts only when their actual implementation lands.
- Record evidence beside the completed phase: changed files, test/interaction result, tested runtime, and remaining limitations. Mark a phase blocked when its acceptance check needs unavailable hardware or services.

## First browser edit

### Phase 001: Reference fixtures

- [x] Select one tiny synthetic Tandem project and record its expected decoded fields.
- [x] Record upstream provenance and licence for the fixture.

Accept when the fixture has no private media and its expected version, IDs, and duration are documented.

### Phase 002: Exact time

- [x] Implement internal integer flick arithmetic without unsafe JavaScript integer operations.
- [x] Match Tandem's six-decimal seconds encoding and 48 kHz sample snapping, including negative times.

Accept when fractional frame rates, frame rounding, negative half-sample rounding, and repeated JSON round trips match reference cases.

### Phase 003: Browser media probe

- [x] Probe decode and encode support for a tiny candidate video/audio fixture.
- [x] Save a capability result for each tested browser, including unsupported codecs.

Accept when one hosted-browser export path is demonstrated or its blocker is explicit before choosing the media dependency.

### Phase 004: Project shell schema

- [x] Define project identity, schema version, settings, and metadata with Effect Schema.
- [x] Decode the empty project fixture with reference defaults.

Accept when malformed settings and newer schema versions produce useful errors.

### Phase 005: Track and media schema

- [x] Add track kinds, ripple modes, and media references.
- [x] Preserve source paths, media roles, and stable IDs during encoding.

Accept when a standard Screen/Camera/B-roll/Graphics/Text and Voice/Music/SFX project round-trips.

### Phase 006: Clip schema

- [x] Decode media clips with start, duration, source start, speed, and link group.
- [x] Preserve text, solid, graphic, and adjustment content for later renderers.

Accept when supported clip variants round-trip and unknown content cannot silently disappear on save.

### Phase 007: Project validation

- [x] Validate references, timing bounds, and track/clip kinds.
- [x] Return stable errors with the affected object ID.

Accept when invalid references and overlapping clips follow the pinned reference rules.

### Phase 008: Command coordinator

- [x] Apply a labelled command batch to a candidate project before committing it.
- [x] Add expected-revision checks and an idempotency key.

Accept when a failed batch changes nothing and retrying the same successful request cannot apply it twice.

### Phase 009: Basic commands

- [x] Implement `updateProject` and `updateSettings`.
- [x] Publish the committed project revision through the session.

Accept when renaming and changing canvas settings update one authoritative snapshot.

### Phase 010: Undo and redo

- [x] Keep labelled undo/redo entries for successful batches.
- [x] Clear redo after a new edit and preserve reference revision behavior.

Accept when undo and redo restore exact project values after a multi-command batch.

### Phase 011: Editor frame

- [x] Replace the starter screen with a top bar, media panel, viewer, inspector, timeline, and status bar.
- [x] Reuse shared theme tokens, fonts, buttons, and Remix Icons.

Accept when the empty editor is usable at 1280x720 and 1920x1080 with no page overflow.

### Phase 012: Panel controls

- [x] Add resizable media/inspector panels and viewer/timeline divider.
- [x] Persist panel sizes and provide keyboard resizing and reset.

Accept when panels respect minimum sizes and reload restores the layout.

### Phase 013: Project controls

- [x] Connect name and canvas settings controls to phase 009 commands.
- [x] Show the actual revision and undo/redo availability.

Accept when settings edits can be undone from the UI without creating another project store.

### Phase 014: Browser save

- [x] Persist project snapshots in IndexedDB through the browser adapter.
- [x] Show saving, saved, and failed-save states.

Accept when reload restores a project and a failed write leaves the last valid save available.

### Phase 015: Open and download

- [x] Open a `.tandem` file through a browser file picker.
- [x] Download a validated `.tandem` snapshot.

Accept when open/download/reopen preserves supported project fields and reports missing media separately.

### Phase 016: Single writer

- [x] Coordinate browser tabs so only one session writes a project.
- [x] Offer read-only or recovery behavior to a second tab.

Accept when two tabs cannot overwrite each other's revisions.

### Phase 017: Media registration

- [x] Implement `addMedia`, `updateMedia`, and `removeMedia` with reference validation.
- [x] Register picked files as local resources without putting File objects in project JSON.

Accept when a selected file appears once and removing referenced media follows the reference policy.

### Phase 018: Media bin

- [x] Display local media with type, name, duration, and missing/unsupported states.
- [x] Add file input and file drop using the same import action.

Accept when importing a supported fixture works through both entry points without uploading its bytes.

### Phase 019: Track commands

- [x] Implement `addTrack`, `removeTrack`, `moveTrack`, and `updateTrack`.
- [x] Render ordered track headers with lock, mute, and ripple mode controls.

Accept when track order and controls round-trip through undo and save.

### Phase 020: Initial placement

- [x] Implement `insertClip` in the reference non-ripple placement mode.
- [x] Place a bin item on a compatible timeline track.

Accept when dropping a source creates the expected source range and a single undo entry.

### Phase 021: Timeline navigation

- [x] Render a time ruler, scrollable tracks, and clip blocks from project data.
- [x] Add zoom and fit-to-project controls.

Accept when ruler, clips, and playhead agree at different zoom levels.

### Phase 022: Selection and seek

- [x] Add clip selection, multiselection, and clear selection.
- [x] Seek by ruler click and frame-step controls.

Accept when selection reaches the inspector and stepping uses the rational project frame rate.

### Phase 023: Single-source viewer

- [x] Decode and display the source frame at the selected timeline time.
- [x] Release decoder and file resources when the session closes.

Accept when seek displays the expected frame, including a nonzero source timestamp fixture.

### Phase 024: Playback clock

- [x] Drive playback from a media/audio clock outside React's render loop.
- [x] Connect play, pause, end, and seek controls.

Accept when playback and seeking remain synchronized through a short fixture.

### Phase 025: Split

- [x] Implement `blade`, preserving left IDs and assigning deterministic right IDs.
- [x] Connect split-at-playhead and the matching shortcut.

Accept when repeated splits in one batch resolve the intended pieces and undo restores the original.

### Phase 026: Trim

- [x] Implement non-ripple `trim` with source-bound checks.
- [x] Add timeline trim handles and numeric start/end editing.

Accept when dragging and numeric editing produce the same command result.

### Phase 027: Move and lift

- [x] Implement `moveClips` and non-ripple `removeClips`.
- [x] Add snapping, drag cancellation, and delete selection.

Accept when cancel leaves no edit and a lift preserves the resulting gap.

### Phase 028: First export

- [x] Export the supported single-track browser slice through the phase 003 path.
- [x] Show progress, cancellation, and an explicit unsupported-feature preflight.

Accept when import, split, trim, export, and reopening the result work at a hosted URL. This is the first usable edit, not full parity. Implementation and localhost production-preview checks pass; public hosting acceptance remains pending.

## Editing semantics and persistence

### Phase 029: Link groups

- [x] Implement `link` and `unlink`.
- [x] Apply reference linked-selection and linked-edit behavior.

Accept when a linked camera/voice edit moves together and unlink makes independent edits possible.

### Phase 030: Ripple delete

- [x] Implement `rippleDeleteRange` and ripple `removeClips`.
- [x] Respect cut/follow/off, locked tracks, links, and marker movement.

Accept when a reference multi-track deletion matches the resulting project and warnings.

### Phase 031: Range cutting

- [x] Implement `cutRanges` using unioned input ranges.
- [x] Implement `closeGap` with reference gap detection.

Accept when overlapping cuts remove each instant once and gap closure preserves sync.

### Phase 032: Insert time

- [x] Implement `insertTime`, including cut-boundary snapping.
- [x] Finish `insertClip` insert-mode ripple behavior.

Accept when spanning follow clips, exact-boundary markers, and locked tracks match reference cases.

### Phase 033: Ripple trim

- [x] Extend `trim` with ripple behavior.
- [x] Keep linked edits and neighboring markers synchronized.

Accept when growing and shrinking an edge match reference results without sliver clips.

### Phase 034: Roll

- [x] Implement `roll` with neighboring source-handle checks.
- [x] Add a roll interaction without changing total duration.

Accept when the cut moves, both source ranges change correctly, and undo restores them.

### Phase 035: Slip

- [x] Implement `slip` while preserving timeline placement.
- [x] Expose the source-offset adjustment in the inspector.

Accept when invalid source offsets reject atomically.

### Phase 036: Slide

- [x] Implement `slide` with neighboring trim adjustments.
- [x] Add its timeline interaction and lock handling.

Accept when the selected clip moves and overall timeline duration stays constant in the reference fixture.

### Phase 037: Join

- [x] Implement `join` and `joinThroughEdits` eligibility rules.
- [x] Explain skipped joins in the result and UI.

Accept when effect equivalence, links, keyframes, and locked tracks match reference join cases.

### Phase 038: Speed

- [x] Implement `setSpeed`, including ripple and source mapping.
- [x] Add a speed inspector with allowed-value validation.

Accept when durations and source positions match after speed changes and undo.

### Phase 039: Held frames

- [x] Implement `holdFrame` and `updateClip` hold-edge validation.
- [x] Render held source edges with silence outside the audio source.

Accept when head/tail holds and freeze ranges display and export consistently.

### Phase 040: Clip patches

- [x] Complete `updateClip` patch decoding, null handling, and validation.
- [x] Expose enabled, name, and tags controls.

Accept when omitted fields stay unchanged and invalid patches cannot partially apply.

### Phase 041: Media placement defaults

- [x] Implement `placeMedia` roles, default tracks, and insertion modes.
- [x] Match linked camera/voice placement and speech-level defaults.

Accept when placing a paired fixture produces the reference track and clip structure.

### Phase 042: Synced placement

- [x] Implement `placeSynced` with source offsets and take identity.
- [x] Expose paired-take placement from the bin.

Accept when screen/camera/voice keep their timing relationship across placement and ripple edits.

### Phase 043: Angle selection

- [ ] Implement `showAngle` for a range and selected angle track.
- [ ] Add an angle-switch action using the command.

Accept when enabled picture changes without doubling voice or losing source synchronization.

### Phase 044: Journal

- [ ] Persist revisioned command entries with deterministic IDs and authors.
- [ ] Replay the journal from a saved snapshot.

Accept when replay produces the same project and cannot duplicate a retried edit.

### Phase 045: Recovery

- [ ] Recover from an interrupted snapshot/journal write.
- [ ] Preserve a recoverable previous version and explain save conflicts.

Accept when injected failures cannot replace a valid project with partial data.

### Phase 046: Schema migration

- [ ] Port the older-schema migrations present in the pinned reference.
- [ ] Preserve future or unsupported fields in a safe read-only import path.

Accept when a supported legacy fixture upgrades correctly and an unsupported project cannot be destructively resaved.

## Shared picture rendering

### Phase 047: Render plan

- [ ] Map project time to active layers and source ranges in portable render-core.
- [ ] Make preview and export consume that same plan.

Accept when layer order, disabled tracks, gaps, and cut boundaries have fixture assertions.

### Phase 048: Composite picture

- [ ] Composite multiple video/image/solid layers.
- [ ] Match canvas fit, normalized position, and clockwise rotation.

Accept when the reference picture-in-picture fixture has the expected geometry.

### Phase 049: Crop and opacity

- [ ] Apply fractional source crop and layer opacity in reference order.
- [ ] Connect transform/crop/opacity inspector controls through `updateClip`.

Accept when source crop and canvas movement agree in preview and export.

### Phase 050: Layout presets

- [ ] Implement `applyLayout` with reference full/PiP/split presets.
- [ ] Apply and reset presets through inspector actions.

Accept when each preset produces the reference transforms and associated properties.

### Phase 051: Region zoom

- [ ] Implement `zoomToRegion` geometry and timing.
- [ ] Add a source-region selection interaction.

Accept when the selected normalized source region fills the intended canvas area.

### Phase 052: Keyframe evaluation

- [ ] Implement `setKeyframes` and reference parameter addressing.
- [ ] Evaluate number, point, color, bool, and string values with reference interpolation.

Accept when ease curves, held values, hue wrap, and clip-relative times match fixtures.

### Phase 053: Keyframe controls

- [ ] Add keyframe add/remove/navigation for one transform parameter.
- [ ] Extend the same controls to supported effect and audio parameters.

Accept when an animated property is editable and undoable without modifying unrelated keyframes.

### Phase 054: Motion presets

- [ ] Implement `addMotion` using the reference preset definitions.
- [ ] Expose its duration and available motion choices.

Accept when photo motion respects source overflow and matches generated keyframes.

### Phase 055: Effect stack

- [ ] Implement `addEffect`, `updateEffect`, `removeEffect`, and `moveEffect`.
- [ ] Build ordered effect controls from registry metadata.

Accept when stack order, enabled state, parameter defaults, and unsupported-effect warnings survive save/reopen.

### Phase 056: Color adjustment

- [ ] Port `colorAdjust` parameters and rendering.
- [ ] Connect its inspector controls and reset.

Accept when synthetic color patches match the agreed reference tolerance.

### Phase 057: HSL

- [ ] Port `hsl` channel adjustments.
- [ ] Add the channel mixer controls.

Accept when hue boundaries and neutral defaults match reference fixtures.

### Phase 058: Color wheels

- [ ] Port `colorWheels`, including parameter interpolation.
- [ ] Add wheel controls and reference reset behavior.

Accept when lift/gamma/gain and animated hue match reference cases within recorded tolerance.

### Phase 059: LUT

- [ ] Load and validate the reference LUT format.
- [ ] Implement `lut` sampling and intensity.

Accept when identity and test LUTs match preview/export and missing LUTs produce warnings.

### Phase 060: Vignette

- [ ] Implement `vignette` parameters and rendering.
- [ ] Add its registry-driven inspector section.

Accept when center and edge falloff match the reference test image.

### Phase 061: Sharpen

- [ ] Implement `sharpen` parameters and rendering.
- [ ] Connect enabled and strength controls.

Accept when a synthetic edge image matches the recorded tolerance without altering alpha unexpectedly.

### Phase 062: Blur

- [ ] Implement `blur` parameters and edge handling.
- [ ] Connect blur controls and keyframes.

Accept when animated blur matches preview/export on an alpha fixture.

### Phase 063: Pixelate

- [ ] Implement `pixelate` block geometry.
- [ ] Connect its inspector controls.

Accept when block alignment and strength match reference frames.

### Phase 064: Drop shadow

- [ ] Implement `dropShadow` using the reference alpha/transform order.
- [ ] Connect shadow color, offset, and softness controls.

Accept when transparent overlays cast the expected shadow without an opaque rectangle.

### Phase 065: Border

- [ ] Implement `border` thickness and color semantics.
- [ ] Expose its controls for a transformed layer.

Accept when border geometry matches reference images at two output resolutions.

### Phase 066: Rounded corners

- [ ] Implement `roundedCorners` clipping.
- [ ] Verify its position in the crop/effect/shadow pipeline.

Accept when a cropped PiP layer has the expected corner and shadow shape.

### Phase 067: Adjustment clips

- [ ] Apply adjustment-content effects to the reference underlying layer group.
- [ ] Expose insertion and effect editing for an adjustment clip.

Accept when only the intended underlying picture changes in preview/export.

### Phase 068: Transition structure

- [ ] Implement `addTransition`, `updateTransition`, and `removeTransition` validation.
- [ ] Render transition handles and duration controls in the timeline.

Accept when head, tail, touching-clip, and missing-handle cases match reference warnings.

### Phase 069: Dissolve and fades

- [ ] Implement `dissolve`, `fadeToBlack`, and `fadeFromBlack`.
- [ ] Match centered cuts and held edge frames.

Accept when start/mid/end reference frames and duration boundaries pass.

### Phase 070: Push and slide

- [ ] Implement `push` and `slide` with four directions.
- [ ] Match single-overlay entry/exit behavior.

Accept when lower tracks show correctly behind an exiting overlay.

### Phase 071: Remaining transitions

- [ ] Implement `cutSlide`, `wipe`, and `zoom`.
- [ ] Match their reference durations and direction rules.

Accept when per-type reference frames pass at both ordinary cuts and overlay edges.

## Sound

### Phase 072: Timeline audio

- [ ] Schedule audible clips from the shared render plan.
- [ ] Match track mute, clip enabled state, source offsets, and silence in gaps.

Accept when a multi-track pulse fixture remains in sync during seek and playback.

### Phase 073: Gain and fades

- [ ] Apply clip gain, gain keyframes, and fade envelopes in reference order.
- [ ] Connect audio level and fade controls.

Accept when keyframed gain replaces base gain and silence thresholds match reference behavior.

### Phase 074: Loudness measurement

- [ ] Measure integrated LUFS, true peak, and loudness range on source audio.
- [ ] Cache results by source identity and analysis version.

Accept when synthetic calibration signals match recorded reference tolerances.

### Phase 075: Speech normalization

- [ ] Implement `normalizeSpeech` with measured-source level adjustments.
- [ ] Match speech-role selection, locked-track warnings, and normalization limits.

Accept when reference normalization produces the expected project patches. Complete protective dynamics after phases 077-078.

### Phase 076: Pitch shift

- [ ] Implement `pitchShift` with reference parameters.
- [ ] Connect controls and the speed/pitch behavior required by the reference.

Accept when a tone fixture meets frequency and duration tolerances.

### Phase 077: Compressor

- [ ] Implement `compressor` with reference parameter ranges.
- [ ] Match speech normalization's automatic compressor insertion rules.

Accept when an amplitude-step fixture and normalization project patches match reference expectations.

### Phase 078: Limiter and master

- [ ] Implement `limiter` and the reference master loudness/peak pipeline.
- [ ] Complete normalization's existing-limiter and peak-protection behavior.

Accept when export meets the configured ceiling and an explicitly disabled limiter stays disabled.

### Phase 079: Voice cleanup

- [ ] Select and integrate an equivalent local `voiceCleanup` processor.
- [ ] Expose unsupported/unavailable processor states and reference controls.

Accept when a licensed speech/noise fixture meets recorded intelligibility, noise, and runtime criteria on each claimed target.

### Phase 080: Voice isolation

- [ ] Implement the clip's separate `audio.voiceIsolation` mix property.
- [ ] Match its interaction with cleanup, gain, and normalization.

Accept when original/isolated endpoints and intermediate mixes export consistently with preview.

### Phase 081: Crossfades

- [ ] Apply reference audio-track transition crossfades.
- [ ] Keep out-of-source transition handles silent.

Accept when cut-centered fades contain no discontinuity beyond the defined tolerance.

### Phase 082: Transition sounds

- [ ] Tie ordinary SFX clips to transitions through `soundClipID`.
- [ ] Match movement, replacement, detach, deletion, and undo behavior.

Accept when a roll/ripple/removal sequence preserves the reference sound offset and lifecycle.

### Phase 083: Sound settings and meters

- [ ] Add transition-type default sound settings and source attribution.
- [ ] Display mix levels and clipping warnings from the actual audio pipeline.

Accept when a configured transition sound can be edited as an ordinary SFX clip.

## Analysis, words, and reusable content

### Phase 084: Background jobs

- [ ] Add scoped Effect jobs with priorities, progress, and bounded concurrency.
- [ ] Wire cancellation to the actual worker/decoder and release resources.

Accept when cancelling and reopening a job cannot leave a stale result or running encoder.

### Phase 085: Thumbnails and waveforms

- [ ] Generate cached thumbnails and waveform peaks.
- [ ] Render visible timeline/bin samples without decoding every offscreen item.

Accept when seeking, resizing, and scrolling reuse valid cached analysis.

### Phase 086: Proxies

- [ ] Generate a supported lower-resolution proxy while preserving source-time mapping and alpha.
- [ ] Switch preview sources without changing final-export source selection.

Accept when a proxy-backed alpha clip and original export agree on time and transparency. Codec differences remain in the capability report.

### Phase 087: Take identification

- [ ] Port filename/role pairing and persisted take offsets.
- [ ] Expose manual correction for ambiguous pairs.

Accept when a Record It naming fixture groups as the reference does without merging unrelated takes.

### Phase 088: Waveform sync

- [ ] Implement reference-style audio alignment for paired takes.
- [ ] Show confidence/failure and allow offset correction.

Accept when a known-delay fixture aligns within the documented sample tolerance.

### Phase 089: Local transcription

- [ ] Integrate one local transcription backend with word timestamps.
- [ ] Track model availability, progress, cancellation, and source-time cache entries.

Accept when a licensed speech fixture yields usable word timing without an undisclosed upload. Backend quality differences are recorded.

### Phase 090: Timeline words

- [ ] Map transcript words through source trims, speed changes, and cuts.
- [ ] Render a seekable transcript lane using the same query model.

Accept when cut words appear once under the reference majority/half-word rules.

### Phase 091: Search

- [ ] Implement case/punctuation-insensitive phrase search.
- [ ] Include partial matches and matches in removed source material as the reference does.

Accept when UI and service queries return the same timeline/source ranges.

### Phase 092: Pauses

- [ ] Refine word bounds against waveform activity.
- [ ] Detect pauses only inside fully transcribed speech coverage.

Accept when gaps and missing transcripts are not mistaken for removable pauses.

### Phase 093: Tighten

- [ ] Build a dry-run pause-removal proposal with reference minimum/retained pause options.
- [ ] Apply accepted cuts through the existing command coordinator.

Accept when a preview and its applied cuts agree, with one undo restoring all tracks.

### Phase 094: Text and fonts

- [ ] Render text content with reference style overrides and preset precedence.
- [ ] Resolve fonts and report explicit fallback warnings.

Accept when legacy and current text styles round-trip and missing fonts are visible in preflight.

### Phase 095: Title animation

- [ ] Port the implemented reference in/out title animations and preset defaults.
- [ ] Add title text/style/animation inspector controls.

Accept when title layout and animation boundaries match saved reference frames within font tolerances.

### Phase 096: Captions

- [ ] Generate caption clips from the shared timeline-word query.
- [ ] Render word highlighting with clip-relative caption timings.

Accept when a cut-through-word fixture has matching transcript/caption inclusion and an undoable generation batch.

### Phase 097: Markers and comments

- [ ] Implement `addMarker`, `updateMarker`, and `removeMarker`, including ranges and review metadata.
- [ ] Add marker/section/chapter, todo, and comment strips with navigation.

Accept when marker edits, ripple movement, and comment state survive save and undo.

### Phase 098: Section cards

- [ ] Implement `addSectionCards` with reference placement and insertion behavior.
- [ ] Implement `fitSectionCards` and render the reference card style and sounds.

Accept when changing section words refits the card correctly and insertion moves its section marker as specified.

### Phase 099: Templates

- [ ] Implement `insertTemplate`, remapping IDs and relative timing.
- [ ] Expose the implemented reference template definitions as insertion choices.

Accept when repeated insertion has no ID collisions and retains links/effects/credits.

### Phase 100: Alternate formats

- [ ] Implement `setFormatLayout` and `adoptFormat` with per-format overrides.
- [ ] Add format preview selection and the reference short-generation proposal.

Accept when adopting portrait preserves keyframe geometry and removes the adopted alternate as the reference does.

### Phase 101: Cutout matte

- [ ] Integrate an equivalent local person/person-and-props segmentation backend.
- [ ] Cache timestamped mattes and report unavailable or incomplete analysis.

Accept when a licensed person/microphone fixture meets documented quality/runtime criteria on each claimed target.

### Phase 102: Cutout controls

- [ ] Composite mattes with reference feather, choke, and repair masks.
- [ ] Expose cutout controls and include/exclude mask editing.

Accept when manual repair, transformed PiP, and alpha export match the declared tolerances.

### Phase 103: Asset catalogue

- [ ] Store asset identity, kind, source, licence, credits, and normalized paths.
- [ ] Add local library search, detail, and missing-file states.

Accept when asset metadata remains attached through project use and save/reopen.

### Phase 104: Static asset normalization

- [ ] Normalize supported images/SVG and LUT assets into renderable local resources.
- [ ] Validate imported fonts and keep their licence files.

Accept when one fixture of each supported kind imports and unsupported input fails clearly.

### Phase 105: Animated assets

- [ ] Normalize reference-supported animated sticker/Lottie content with alpha.
- [ ] Preserve graphic props and warn for unimplemented graphic engines.

Accept when an alpha animation plays over video with matching preview/export timing.

### Phase 106: Asset use and credits

- [ ] Attach library assets to projects without losing provenance.
- [ ] Generate credits and install licensed starter content without overwriting user assets.

Accept when the project's credit report includes each used credited resource exactly as required.

### Phase 107: Provider interface

- [ ] Add provider capabilities, setup status, and validated search/fetch contracts.
- [ ] Add secure platform credential access without exposing secrets in project JSON or logs.

Accept when the UI can distinguish missing setup, unsupported browser transport, and a failed provider request.

### Phase 108: Provider adapters

- [ ] Implement one working pinned-reference provider per subphase, including attribution and normalization.
- [ ] Cover shared/local import folders, Pixabay, Pexels, Freesound, Iconify, SVGL, Noto Emoji, Fontsource, and ElevenLabs only where upstream actually implements them.

Accept each subphase independently against its request/result contract. Stubbed upstream providers remain labelled stubs. Do not implement this list as one large change.

### Phase 109: Generation

- [ ] Port the implemented reference generation request/options and result storage.
- [ ] Add cost/confirmation behavior for user-initiated paid requests and record generated provenance.

Accept when a mocked provider validates the contract and opt-in live testing records an actual result. No paid request runs as part of ordinary checks.

### Phase 110: Saved segments

- [ ] Save/list a reusable timeline segment with its media references and metadata.
- [ ] Insert it with remapped IDs through `insertTemplate` or equivalent reference commands.

Accept when linked clips, assets, transitions, and credits survive save/insert in another project.

## Desktop and interchange

### Phase 111: Electron host

- [ ] Load the shared built editor in an isolated Electron renderer.
- [ ] Add a narrow validated preload bridge with browser/native import boundaries.

Accept when the browser build still works and renderer content cannot call arbitrary Node APIs.

### Phase 112: Host project service

- [ ] Move desktop project authority into the host process.
- [ ] Connect renderer actions and subscriptions through typed requests/events.

Accept when closing/reopening a window cannot create a competing writer.

### Phase 113: Native persistence

- [ ] Implement atomic file saves, backups, and project locking.
- [ ] Surface external modification and recovery choices.

Accept when interruption and lock-contention fixtures preserve the last valid `.tandem` file.

### Phase 114: Folder scanning

- [ ] Scan selected folders recursively with the reference exclusions and role rules.
- [ ] Watch for completed new/changed files without importing temporary writes.

Accept when adding media to a selected folder updates its catalogue without duplicates or recursive cache imports.

### Phase 115: Native media jobs

- [ ] Add native probing/decode/export execution behind existing service ports.
- [ ] Integrate progress, cancellation, child-process cleanup, and decoder failure reporting.

Accept when one desktop fixture edits/exports and cancellation leaves no orphan process. Each additional codec/backend is a separate follow-up phase.

### Phase 116: Relink and archive

- [ ] Relink missing sources with safe path handling and identity checks.
- [ ] Archive referenced project/library media and metadata with relative paths.

Accept when a browser-to-desktop archive and desktop-to-browser archive reopen after the original paths are unavailable.

### Phase 117: EDL import

- [ ] Decode the reference segment EDL and explicit recipe configuration.
- [ ] Build a project through validated commands and emit an import report.

Accept when a synthetic recipe fixture preserves clip order, source ranges, and sync offsets without Mike-specific absolute paths.

### Phase 118: Filmora import

- [ ] Read supported WFP containers safely and map implemented source fields.
- [ ] Report unsupported effects, missing sources, and approximations.

Accept when licensed/synthetic upstream-style fixtures match the reference import mapping. Split container decoding and each mapping family if either exceeds a small phase.

## Agent and review compatibility

### Phase 119: Local service transport

- [ ] Expose a loopback host service with reference `/v1/<operation>` envelopes.
- [ ] Validate/authenticate requests and reject unauthorized origins and unsafe filesystem output paths.

Accept when a permitted client reaches the same project coordinator as the renderer and unrelated web origins cannot mutate it.

### Phase 120: Project query operations

- [ ] Add `status`, `timeline`, `media`, and `clips` adapters over existing services.
- [ ] Match filtering, summaries, JSON/text results, warnings, and revision fields.

Accept one operation per subphase against pinned request/result fixtures, including media's mutation behavior.

### Phase 121: Edit and history operations

- [ ] Expose `apply`, `undo`, `redo`, and `history`.
- [ ] Add `diff` and `restore` over the journal and reference review baseline semantics.

Accept one operation per subphase. A concurrent human/agent stale revision must reject without partial edits.

### Phase 122: Speech operations

- [ ] Expose `transcript`, `transcribe`, `search`, and `pauses`.
- [ ] Expose `tighten` with the same preview/application policy as the UI.

Accept one operation per subphase, including missing-analysis and partial-cut cases.

### Phase 123: Generation and edit helpers

- [ ] Expose `join`, `captions`, `short`, and `cards`.
- [ ] Match defaults, dry-run behavior, generated IDs, warnings, and author labels.

Accept one helper per subphase by comparing its proposed/applied project with reference fixtures.

### Phase 124: Frame inspection

- [ ] Expose `frame` and `frames`, including labelled contact sheets and range limits.
- [ ] Implement `screenshot` using an actual editor capture where supported.

Accept each operation separately, including requested dimensions and missing-font/matte warnings. Do not substitute a frame for a UI screenshot.

### Phase 125: Render operations

- [ ] Expose `clip`, `export`, and `loudness` through the existing render pipeline.
- [ ] Match ranges, format/preset sizing, stems, audio-only output, and result paths.

Accept one operation per subphase with synthetic audio/video output assertions. Finish each output mode separately if needed.

### Phase 126: Quality and review

- [ ] Implement `validate`, `check`, and `comments` results over project/review queries.
- [ ] Add the reference quality scan and review/activity navigation.

Accept each query/scan separately against fixtures with known warnings, comment states, and reviewed revisions.

### Phase 127: Jobs and change streams

- [ ] Expose `sync`, `watch`, and `wait` with revision/job progress semantics.
- [ ] Match timeout, cancellation, and reconnect behavior without rerunning completed mutations.

Accept one operation per subphase, including connection closure during a running job.

### Phase 128: Resource operations

- [ ] Expose `archive`, `relink`, and `effects`.
- [ ] Match render/analysis capability warnings and supported registry metadata.

Accept one operation per subphase against the existing archive, relink, and registry fixtures.

### Phase 129: Asset operations

- [ ] Expose all 11 reference asset/segment operations listed below.
- [ ] Map their exact MCP names and preserve project-required/library-only distinctions.

Accept one operation per subphase. Provider calls remain opt-in and credentials never enter returned JSON.

### Phase 130: CLI

- [ ] Add cross-platform argument parsing, project discovery, help/schema, JSON output, and exit codes.
- [ ] Wire one previously verified operation per subphase, including new/open/import and asset/segment commands.

Accept when a script creates, edits, inspects, and exports a project through the host without a second coordinator. Add an opt-in `tandem` launcher only after checking name collisions.

### Phase 131: MCP

- [ ] Add stdio MCP lifecycle, schemas, and reference server instructions.
- [ ] Wire one of the 43 listed tools per subphase with the correct text/image result blocks.

Accept when a real MCP client can inspect, edit, undo, and inspect a frame while the UI shows the same revisions.

### Phase 132: TypeScript client

- [ ] Generate client request/command types from the authoritative schemas.
- [ ] Port the reference SDK usage patterns over the compatible service.

Accept when a small bulk-edit client handles conflicts and idempotent retries without relying on manually duplicated types.

## Finish and release

### Phase 133: Export presets and queue

- [ ] Complete reference preset sizing/quality, alternate-format exports, and audio-only variants.
- [ ] Add queued jobs, cancellation, error details, and completed-output actions.

Accept each preset/output mode separately against dimensions, frame counts, audio levels, and warnings.

### Phase 134: Keyboard and pointer parity

- [ ] Port implemented reference shortcuts/keymaps, focus rules, context menus, clipboard, and range selection.
- [ ] Match marquee, snapping modifiers, track resizing, scroll/zoom, and drag autoscroll.

Accept one interaction per subphase with a user-facing scenario. Use Ctrl/Cmd appropriately and do not intercept typing in inputs.

### Phase 135: Accessibility and narrow windows

- [ ] Verify keyboard access, focus restoration, labels, contrast, and reduced motion.
- [ ] Adapt panels for smaller windows and verify pointer/touch controls where claimed.

Accept each workflow separately with visible focus and no inaccessible essential action. Mobile editing is a separate support claim.

### Phase 136: Browser compatibility

- [ ] Run the complete hosted edit/save/reopen/export journey in Chromium, Firefox, and WebKit/Safari.
- [ ] Publish tested codec, persistence, model, memory, and file-access limits per browser.

Accept each browser separately. Unsupported essentials remain open gaps and do not pass because another browser works.

### Phase 137: Windows delivery

- [ ] Package/install the desktop application and CLI on Windows.
- [ ] Verify Unicode/space paths, credential storage, locking, import, edit, archive, and export.

Accept when the installed build completes the journey and records signing/install limitations.

### Phase 138: macOS delivery

- [ ] Package/install the desktop application and CLI on macOS.
- [ ] Verify permissions, signing/notarization, credential access, and the same editing journey.

Accept when the installed build passes on real macOS. A Windows build cannot supply this evidence.

### Phase 139: Linux delivery

- [ ] Package/install for the selected Linux distributions and desktop environments.
- [ ] Verify file dialogs, credential fallback, process cleanup, codecs, and the same journey.

Accept each declared distribution/session separately and document unverified combinations.

### Phase 140: Pinned parity audit

- [ ] Compare every command, service operation, tool, effect, transition, and UI workflow with the baseline inventories.
- [ ] Run Tandem -> SideCut -> Tandem round trips on macOS and compare render/audio references on all targets.

Accept when the compatibility report links evidence for every supported claim, lists remaining gaps, and names the pinned upstream revision. Only then describe the release's actual parity level.

## Complete inventory and phase ownership

The following inventories prevent features from disappearing between UI, core, service, and agent work. A core command passing does not establish its CLI/MCP compatibility. The [named adapter subphases](tandem-adapter-phases.md) split provider, service, CLI, and MCP groups into individual implementation units now. Complete and verify one subphase before starting the next.

### Edit commands: 51

- Phase 009: `updateProject`, `updateSettings`.
- Phase 017: `addMedia`, `updateMedia`, `removeMedia`.
- Phase 019: `addTrack`, `removeTrack`, `moveTrack`, `updateTrack`.
- Phases 020/032: `insertClip`.
- Phase 025: `blade`.
- Phases 026/033: `trim`.
- Phase 027: `moveClips`; phases 027/030: `removeClips`.
- Phase 029: `link`, `unlink`.
- Phase 030: `rippleDeleteRange`.
- Phase 031: `cutRanges`, `closeGap`.
- Phase 032: `insertTime`.
- Phase 034: `roll`. Phase 035: `slip`. Phase 036: `slide`.
- Phase 037: `join`, `joinThroughEdits`.
- Phase 038: `setSpeed`. Phase 039: `holdFrame`. Phase 040: `updateClip`.
- Phase 041: `placeMedia`. Phase 042: `placeSynced`. Phase 043: `showAngle`.
- Phase 050: `applyLayout`. Phase 051: `zoomToRegion`.
- Phase 052: `setKeyframes`. Phase 054: `addMotion`.
- Phase 055: `addEffect`, `updateEffect`, `removeEffect`, `moveEffect`.
- Phase 068: `addTransition`, `updateTransition`, `removeTransition`.
- Phases 075/077/078: `normalizeSpeech`.
- Phase 097: `addMarker`, `updateMarker`, `removeMarker`.
- Phase 098: `addSectionCards`, `fitSectionCards`.
- Phase 099: `insertTemplate`.
- Phase 100: `setFormatLayout`, `adoptFormat`.

### Project service operations: 34

- Phase 120: `status`, `media`, `timeline`, `clips`.
- Phase 121: `apply`, `undo`, `redo`, `history`, `diff`, `restore`.
- Phase 122: `transcript`, `transcribe`, `search`, `pauses`, `tighten`.
- Phase 123: `join`, `captions`, `short`, `cards`.
- Phase 124: `frame`, `frames`, `screenshot`.
- Phase 125: `clip`, `export`, `loudness`.
- Phase 126: `validate`, `check`, `comments`.
- Phase 127: `sync`, `watch`, `wait`.
- Phase 128: `effects`, `archive`, `relink`.

### Asset and segment operations: 11

Phase 129 covers `providers`, `search`, `fetch`, `show`, `use`, `credits`, `generate`, `install-starter`, `segments`, `save-segment`, and `insert-segment`. They reuse phases 103-110 rather than implementing separate asset logic.

### MCP tools: 43

Phase 131 exposes these exact names with their pinned schemas:

`status`, `timeline`, `media`, `transcript`, `transcribe`, `search`, `pauses`, `tighten`, `join`, `captions`, `short`, `cards`, `apply`, `undo`, `redo`, `history`, `diff`, `restore`, `clips`, `validate`, `check`, `sync`, `comments`, `frame`, `frames`, `screenshot`, `clip`, `export`, `archive`, `relink`, `loudness`, `watch`, `wait`, `assets_search`, `assets_use`, `assets_show`, `assets_credits`, `assets_generate`, `segments_list`, `segments_save`, `segments_insert`, `assets_providers`, `effects`.

### Effects: 15

Phases 056-066 cover `colorAdjust`, `hsl`, `colorWheels`, `lut`, `vignette`, `sharpen`, `blur`, `pixelate`, `dropShadow`, `border`, and `roundedCorners`. Phases 076-079 cover `pitchShift`, `compressor`, `limiter`, and `voiceCleanup`. Voice isolation and cutout are separate clip properties, not extra registry effects.

### Transitions: 8

Phase 069 covers `dissolve`, `fadeToBlack`, and `fadeFromBlack`. Phase 070 covers `push` and `slide`. Phase 071 covers `cutSlide`, `wipe`, and `zoom`. Phases 081-083 complete audio crossfades and transition sounds.

## Delivery checkpoints

- After phase 013: an interactive editor frame and settings, with no claim of media editing.
- After phase 028: the first real hosted-browser editing/export journey.
- After phase 046: the listed core edit families and recovery work; remaining layout/effect/content commands arrive later.
- After phase 102: the main multi-track picture, sound, transcript, title, caption, and cutout workflows, subject to recorded backend limits.
- After phase 118: desktop host and interchange functionality ready for platform verification.
- After phase 132: service, CLI, MCP, and SDK behavior ready for parity verification.
- After phase 140: an evidence-backed compatibility report and platform-specific release claims.

Cloud accounts, cloud storage, real-time remote collaboration, billing, and upstream features that are still unimplemented are outside this roadmap. They do not block local Tandem parity.
