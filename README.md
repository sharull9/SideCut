# SideCut

Foundation for a browser-first video editor with an optional desktop application.
The shared editing engine, desktop application, and agent tools follow [the architecture plan](docs/monorepo-plan.md).
The editor has resizable panels, editable sequence properties, browser autosave,
project open/download, a local media bin, and a timeline with track controls,
source placement, zoom, selection, seeking, source playback, split/trim/move,
linked edits, ripple deletion/insertion, roll/slip/slide, joins, speed, held frames,
role/synced placement, angle switching, animated picture compositing, and local WebM export.

The [Tandem parity roadmap](docs/tandem-parity-roadmap.md) breaks the editor, media,
desktop, and agent work into small phases with acceptance checks and a pinned
upstream feature inventory. Phases 001-110 have implementations, with phase 028's
public-host acceptance still pending: synthetic reference
fixtures, exact flick timing, a browser media feasibility probe, and Effect schemas
for projects, tracks, media, and clips, project validation, atomic command batches,
undo/redo, a resizable editor frame, sequence properties, project persistence,
single-writer browser tabs, local media registration/import, track commands,
non-ripple clip placement, timeline navigation/selection, source preview, and
audio-clock-driven transport. Thirty-nine command families have implementations.
`insertClip` supports `place` and `insert`; `moveClips` supports `place`. Trimming
supports both ripple and non-ripple edits. Undo history remains in memory and resets
on reload.

Import a source and drag it to a compatible track, or choose Place at playhead.
Video tracks show picture and remain silent; place sound on an audio track.
Use the ruler to seek, the transport to step/play/pause, and Fit or zoom controls
to navigate. Shift/Ctrl/Command-click selects multiple clips. Preview supports
multiple video/image/solid layers with fit, position, scale, and clockwise rotation,
fractional crop, opacity, and picture keyframes, plus mixed audio tracks. Color adjustment, HSL, color wheels, LUTs, and vignette render in both
preview and export. Sharpen, blur, pixelate, borders, rounded corners, and shadows
also render. Adjustment layers, picture transitions, and audio crossfades render in
preview and export. Audio controls support gain, fades, loudness normalization,
pitch, dynamics, voice cleanup, and local RNNoise isolation. Transition sounds are
ordinary editable SFX clips, with per-project defaults. Live mix meters show
clipping, and background jobs expose progress and cancellation. Split with Ctrl/Cmd+K or
Ctrl/Cmd+B, trim with edge handles or inspector fields, and drag clips to move.
Delete lifts selected clips; Shift+Delete removes their time. Link/Unlink controls
keep picture and sound edits together. Export renders supported source edits
locally to VP8/Opus WebM, up to five minutes and 1080p at 1–60 fps. Output length
rounds up to a complete frame. Unsupported processing fails preflight visibly.

Time edits opens controls for inserting time, closing a gap, and cutting multiple
overlapping ranges in one edit. The inspector exposes slip, slide, roll-next-cut,
and ripple edge adjustments. Alt-drag a clip to slip, Alt+Shift-drag to slide,
Alt-drag an edge to roll, and Shift-drag an edge to ripple trim. Shift-dropping a
bin source or choosing Insert at playhead opens time before placing it. These
gestures are verified on Windows Chromium; use numeric controls as an alternative.

The inspector also edits clip names, tags, enabled state, source-edge holds,
speed, and held-frame ranges. Join next clip and Join through-edits remove
compatible cuts while retaining linked timing. Each bin source has Role and take
placement controls for source roles, known take offsets, paired placement, and
adding a synced angle or external mic to an existing take. Synced angles start
disabled. In the inspector, choose an Angle track and a timeline range, then Show
selected angle. Choosing the camera track returns to the base picture. Automatic
alignment by sound is planned.

Picture controls edit position, scale, clockwise rotation, fractional source crop,
and opacity. Layout presets include Full, PiP left/right, Split, and Fill. PiP
preserves the reference cutout/shadow settings. The Picture inspector can analyse a
local cutout, keep a person or person and accessories, and edit feather, choke and
source-coordinate include/exclude repair masks. First use downloads Google's
MediaPipe Selfie Multiclass model; media stays on the device. Analysis supports
sources up to 60 seconds, 3,600 frames and 64 MiB of compressed mattes. Accessories
can need repair masks. Missing or incomplete mattes stop rendering with a clear
error. Download cutout PNG exports a transparent source frame up to 1280 px wide;
video export composites the cutout into the existing opaque WebM output.

Local asset library in Project media stores reusable images, SVG icons, stickers,
fonts and LUTs on this device. Search by name/tags, kind and licence, then choose
Use in project. Originals and licence companions stay in the catalogue; fonts
require a licence file. Self-contained Lottie JSON and animated GIF/WebP/PNG retain
alpha and source timing in preview and export. ImageDecoder is required for
animated images. External Lottie assets, fonts and expressions are unsupported.
Browse providers searches supported public catalogues and downloads assets with
their provenance. Keyed providers and paid ElevenLabs generation require the
desktop host. Generation requires explicit paid confirmation and retains completed
takes after cancellation or a later failure. Live paid generation is unverified.
Credits lists used resources once, and Install starter adds 90 catalogue entries
without replacing existing assets. Saved segments stores selected and linked clips
with local resources for reuse in another project through one undoable insertion.
See the [phases 106-110 report](docs/verification/phases-106-110.md) for provider
coverage and remaining acceptance limits.
Reset layout to full removes those settings. Select source region opens an
original-source preview with drag selection and numeric coordinates. Zoom can be
immediate or animated from the playhead.

Keyframes support transform, opacity, crop, gain, and existing effect parameter
paths, with add/update/remove and previous/next navigation. Times are relative to
the selected clip. Picture and supported color-effect keys render in preview/export.
Gain and pitch keys render too; unsupported effect keys remain stored for later renderers. Motion presets generate full-clip zooms
and pans with linear position/scale keys and an amount from 1 to 3.

The Effects inspector adds, enables, reorders, resets, and removes effects using
registry defaults and ranges. Color wheels support pointer dragging, arrow keys,
and numeric entry. Apply parameters saves the draft; Reset effect removes the
effect and its keys. Media looks precede clip color and spatial effects. Crop is
followed by rounded corners, border, transform, shadow, and group opacity. Each
style uses its first enabled instance, independent of its position in the stack.
Style effects in media looks are ignored, as in the reference. Spatial sizes marked
px@1080 follow the output short side; sharpening follows source resolution.
Borders provide a colored backing behind transparent image holes. Shadows follow
cutout alpha; cutout-following border outlines remain unimplemented.
LUTs accept 1D or 3D `.cube` files up to 32 MB and stay in browser storage. Import
the referenced LUT on each device; an unavailable LUT blocks rendering. CPU color
processing can be slower than real time on large sources or long stacks. Browser
sharpening and Gaussian blur are portable approximations of Core Image, with
recorded synthetic tolerances and native pixel comparison still pending.

Picture speed changes and held frames export locally. Audio at another speed and
speech levelling still need later renderers and produce explicit preflight errors.
Role placement preserves the reference speech-level defaults; mute unsupported
sound to export supported picture edits.

Commands, deterministic IDs, authors, and undo/redo snapshots now persist in a
revisioned journal. Browser saves stage the journal before atomically replacing the
snapshot and retaining the previous version. Reopening recovers interrupted saves;
a conflicting writer cannot overwrite a different stored copy. Command retry keys
survive reload, while the interactive undo stack still resets.

Schema 1 projects migrate legacy title defaults to schema 2. Unsupported schemas
or content open read-only with an original-JSON inspector. Download preserves the
original file text, and that import never replaces the saved project.

Projects persist in SQLite and imported source files persist in OPFS for this browser profile
and origin. Download a project copy for backup. A `.tandem` download contains project
data and media references, not the media bytes. Browser storage can be cleared or
evicted; portable media archives and general source relinking remain planned.

Open `/diagnostics` on the development server to run project round-trip and browser
codec checks. Use the actual port printed by `vp run dev`. The probe produces
synthetic video and audio locally, without camera or microphone access. See
[verification results](docs/verification/phases-001-006.md) for the tested browser
and current limitations.

The [phases 007-012 report](docs/verification/phases-007-012.md) covers validation,
command sessions, editor layout, and keyboard/pointer resizing. The diagnostics
page can apply a sample name/settings batch to the live editor session. Use its
Back to editor link to keep that session and inspect undo/redo.

The [phases 013-018 report](docs/verification/phases-013-018.md) covers settings,
autosave recovery, project interchange, tab ownership, and image/audio/video import.

The [phases 019-024 report](docs/verification/phases-019-024.md) covers track
controls, clip placement, timeline interaction, source-offset decoding, and playback.

The [phases 025-030 report](docs/verification/phases-025-030.md) covers source
editing, linked operations, ripple semantics, export round trips, and current limits.

The [phases 031-036 report](docs/verification/phases-031-036.md) covers range cuts,
insertion, ripple trim, roll, slip, slide, pointer interactions, and source bounds.

The [phases 037-042 report](docs/verification/phases-037-042.md) covers joins,
speed, held frames/edges, clip patches, role defaults, synced placement, and their
rendering limits.

The [phases 043-048 report](docs/verification/phases-043-048.md) covers angle
switching, journal replay, recovery fault injection, migration, shared render plans,
and composite preview/export pixels.

The [phases 049-054 report](docs/verification/phases-049-054.md) covers crop and
opacity, layouts, region zoom, keyframe evaluation/editing, motion presets, and
animated preview/export pixel checks.

The [phases 055-060 report](docs/verification/phases-055-060.md) records effect
commands, color processing, LUT storage, browser/export checks, and tolerances.

The [phases 061-066 report](docs/verification/phases-061-066.md) records spatial
filters, fixed-order layer styles, alpha fixtures, animation, and kernel limits.

The [phases 067-072 report](docs/verification/phases-067-072.md) records adjustment
clips, transition editing and rendering, multi-track audio, and browser/export checks.

## Development

Install the [Vite+ CLI](https://viteplus.dev/guide/) and use `vp` for all project commands. Use Node.js 24.18 or a newer Node 24 release. Vite+ manages the pnpm version pinned in `package.json` underneath; no direct pnpm commands are needed.

```sh
vp install --frozen-lockfile
vp run dev
```

`vp run dev` serves the app at https://sidecut.localhost through Portless, which
chooses the internal app port. OpenSSL must be on PATH for local HTTPS certificate
setup. On Windows with Git installed, its executable is usually in
`C:\Program Files\Git\mingw64\bin`. Portless sets up its local certificate on
first use; follow its trust/setup instructions if prompted. If you previously
configured another proxy port or disabled TLS, run
`vp exec portless proxy start --https --port 443` from `apps/web` to select HTTPS
on the standard port.

For a local production preview, run `vp run build` followed by `vp run preview`.
Preview uses the same URL, so stop dev before starting it. Hosted
deployments continue to use the production build directly.

```sh
vp run check
vp run build
```

`vp run check` runs format checking, Oxlint, TypeScript checks, and Vitest, including
project schema and exact-time tests. Type checking generates TanStack routes first,
including on clean checkouts.

`vp fmt` writes formatting, and `vp lint --fix` applies lint fixes. Vite+ owns Vite, Oxlint, Oxfmt, Vitest, and workspace task execution. Effect 4 supplies the portable project and command schemas.

Dependency commands are `vp add <package>`, `vp remove <package>`, `vp update`, and `vp why <package>`. Use `vp run --filter @sidecut/web <task>` for a workspace task and `vp exec <binary>` for an installed tool.

## Workspace layout

- `apps/web`: TanStack Start in SPA mode, TanStack Router, and feature modules under `src/modules`. Routes compose features.
- `packages/ui`: generated shadcn components, shared styles/fonts, and the template's `cn` utility.
- `packages/config`: TypeScript, Oxlint, and Oxfmt presets. Each family exports `base`, `web`, and `desktop` entry points.
- `packages/contracts`: portable Effect project schemas and exact `bigint` flick timing. The decoder supports schema version 2 and migrates schema 1; unsupported formats have a read-only import path.
- `packages/core`: portable project validation and a synchronous atomic coordinator with revision checks, idempotency, subscriptions, and labelled undo/redo.
- `packages/platform-browser`: SQLite WASM/OPFS project/resource storage, Web Locks writer ownership, save serialization, local media analysis/decoding through MediaBunny, and playback-clock mapping. The web session connects this adapter to the portable coordinator. Zustand owns transient view state in the workspace module.

- `apps/desktop`: Electron shell that loads the built web editor from `apps/web/.output/public` over a privileged `sidecut://app` scheme, with SPA route fallback. The renderer is sandboxed and context-isolated without Node integration; the preload exposes app information and validated provider/credential operations, and the host checks each IPC sender. Provider keys use Electron safeStorage and remain in the host. External links open in the system browser, other navigation is blocked, and permission requests are denied. One host coordinator owns desktop edits and undo history across windows. The host saves project snapshots and validated backups atomically in profile-local SQLite, with an exclusive host lock.

The desktop renderer uses web presets; its host process uses desktop presets. Node globals are excluded from browser TypeScript programs. Browser lint rules prohibit direct host API imports.

```json
{ "extends": "@sidecut/config/typescript/web.json" }
```

```ts
import lint from "@sidecut/config/oxlint/web";
import fmt from "@sidecut/config/oxfmt/web";
import { Button } from "@sidecut/ui/components/button";
import { cn } from "@sidecut/ui/lib/utils";
```

The root `vite.config.ts` composes lint/format presets and applies runtime-specific overrides. Keep workspace-specific ignores there. Dependencies shared across workspaces are pinned in `pnpm-workspace.yaml`'s catalog. Declare direct imports in the consuming package.

`@shadcn/lint` is registered by the shared web preset and recognizes `@sidecut/ui/components` imports. Run it through `vp lint`. No shadcn rules are enabled yet. Add the desired `shadcn/*` rules in `packages/config/oxlint/web.ts`; the root configuration scopes those rules to the web app and shared UI sources. Rules that restrict component usage, such as `no-restyle`, need an exception for the component implementation directory so shared components can define their own styles. See the [available rules](https://github.com/shadcn-ui/lint#rules).

## UI components

Created with shadcn preset `b7kBsBkh7b`: Nova/Base UI, green theme, Remix Icons, Geist Mono, and Instrument Sans headings.

```sh
cd packages/ui
vp exec shadcn add <component> --path src/components
```

Use the explicit path with the shared package's CLI to keep generated files inside
the workspace on Windows. The generated `cn` helper re-exports the `cn` package;
reuse it rather than adding another helper.

## Desktop

```sh
vp run dev:desktop
```

This builds the web renderer and desktop bundles, downloads the pinned Electron binary on first run, and opens the app. `vp run build:desktop` builds without launching. To use the web dev server instead, run `vp run dev` and set `SIDECUT_RENDERER_URL` to the direct `http://127.0.0.1:<port>` address printed by Portless; the desktop window connects directly to the app server because only local http URLs are accepted. Electron fails to open a window if `ELECTRON_RUN_AS_NODE` is set in your shell. Desktop data uses Electron's own profile, separate from browser storage. Linux x64 and Apple Silicon packaging are configured in the [desktop build workflow](docs/desktop-builds.md).

Desktop projects, libraries, media references, and preferences live in the profile's `sidecut.sqlite`; media bytes live in `storage-files`. Existing `current.tandem` and `.bak` files are imported once and retained unchanged. Project versions and backups commit together in SQLite. External database changes stop stale saves and show reload/backup recovery actions. The host still uses `current.tandem.lock`; remove a stale lock only after confirming that no SideCut host is running.

`vp install` installs the desktop FFmpeg and FFprobe dependencies, so **Watch folder** and native media jobs need no system installation or PATH setup. FFmpeg uses `ffmpeg-static@5.3.0` and FFprobe uses `ffprobe-static@3.1.0`; the workspace allows FFmpeg's binary download during installation. Host-only `SIDECUT_FFMPEG` and `SIDECUT_FFPROBE` can override the supplied executable paths. Folder watching scans recursively each second and waits two seconds for writes to settle. It ignores hidden folders, exports, dependency/cache folders, Filmora `.wfp.dir` folders, and symlinks. Changed files retain their media IDs. Reselect the folder after restarting the app, or to retry a failed import. Source copies live in the profile's `storage-files` directory, with SQLite metadata.

Native probing, audio decoding to WAV, and VP8/Opus WebM export support inputs/outputs up to 256 MiB and decode/export ranges up to five minutes. Desktop timeline export uses the shared browser compositor followed by native encoding, so browser composition/codec limits still apply. Missing binaries and decoder failures appear as errors. Cancellation waits for the child to exit and removes temporary files. The real-codec test runs against the installed binaries without relying on PATH. Native packages stay external to the host JavaScript bundle so their executable paths resolve correctly during development. The installed packages retain their licence files, including FFmpeg's downloaded LICENSE and README companions. Desktop packaging copies the matching binaries and their notices into application resources outside ASAR.

After `vp run build:desktop`, run `vp exec electron ../../tests/desktop/verify.mjs` from `apps/desktop` with `ELECTRON_RUN_AS_NODE` unset to check the production renderer, shared authority, folder updates and a complete timeline export. This uses a temporary profile and synthetic audio.

`Archive project` downloads a portable `.sidecut` archive containing source and
library copies. Open it through **Open project** in either browser or desktop;
each import creates an independent project with fresh undo history. Archives
are limited to 256 MiB and require all source media to be available locally.
Missing sources have a **Relink source** control that checks fingerprints and
known media properties. **Open project** also accepts explicit EDL recipe JSON
and basic zipped Filmora `.wfp` imports. Import reports list unsupported fields.
See [supported fields and limits](docs/verification/phases-116-120.md).

While the desktop runs, its profile's `current.tandem.api.json` contains the
loopback HTTP port and bearer token. `GET /v1/health` is public; `status`, `media`,
`timeline` and `clips` require `Authorization: Bearer <token>`. Use `POST` with
`Content-Type: application/json` to pass arguments. `media` with `refresh: true`
scans the selected watched folder and uses the editor's shared edit history.
Browser-origin requests are rejected. Full query and MCP compatibility remain pending.

The desktop service also exposes `apply`, `undo`, `redo`, `history`, `diff`,
`restore`, speech/transcription operations, `join`, `captions`, `short`, `cards`,
`frame`, `frames`, `screenshot`, `clip`, `export` and `loudness`. Helpers preview
by default and require `apply: true` to commit. Pass `expectedRevision` to avoid
overwriting a concurrent edit. Inspection returns PNG data or an output file;
renders and snapshots are saved as new files under the managed profile's
`exports` folder. Existing files are not overwritten. See [service capabilities,
examples and remaining limits](docs/verification/phases-121-125.md).

The service also has baseline review, sync/watch/wait, archive/relink/effects,
asset-library and segment adapters. `node scripts/sidecut-cli.mjs --help` lists
the CLI commands; select the running host with `--endpoint-file` or
`SIDECUT_API_FILE`. The CLI uses Commander.js for argument parsing and the host's
schema and shared edit history. Zod validates discovery files, request objects, and
numeric/boolean flags. Desktop packages include Commander, Zod, and the CLI helpers.
Checks support model and rendered scans; provider network calls are opt-in.
See [CLI usage, verification and compatibility limits](docs/verification/phases-126-130.md).

Saved segments support exact clip selection, title fields, replacement and one-step
insertion with undo. CLI commands accept positional segment names, `--field` and
`--value`, short aliases and guarded project discovery. `schema` prints the edit
schema offline; `schema --service` prints service operations. Native `new`,
`app`, `import edl` and `import filmora` commands use the same running host.
See [segment/CLI acceptance and limits](docs/verification/segments-cli.md).

MCP is available with `node scripts/sidecut-mcp.mjs --endpoint-file <discovery-file>`.
It exposes 43 tools through the same host, with PNG results for frame inspection.
`@sidecut/client` derives TypeScript requests from the host definitions.
The Export dialog now retains queued WebM/WAV downloads, and the editor includes
more keyboard/clipboard controls and a compact desktop layout. See
[setup, verification and remaining gaps](docs/verification/phases-131-135.md).

Windows now has a per-user NSIS installer with a bundled CLI launcher. The installed
app passes import/edit/export/archive/reopen checks in a temporary Unicode/space
path. Chromium and Firefox pass the production browser journey on Windows;
the tested WebKit port lacks required media APIs. macOS/Linux installation gates
are prepared for native CI but remain unverified. See the
[delivery, browser matrix and pinned parity audit](docs/verification/phases-136-140.md).

Desktop downloads can be built manually from **Actions**, **Desktop builds**, **Run workflow**, or by pushing a version tag such as `v0.1.0`, after the workflow is pushed to GitHub. Linux builds produce AppImage and `.deb`; Apple Silicon builds produce `.dmg` and `.zip`. The workflow verifies the packaged app before uploading downloads, which expire after one day. macOS builds use ad-hoc signing and are not notarized. See [desktop builds](docs/desktop-builds.md) for commands, resource layout, free-tier limits and verification status.

## Static hosting

`vp run build` uses Nitro to package TanStack Start. For static hosting, serve `apps/web/.output/public` and rewrite unmatched application routes to `_shell.html` while serving existing assets normally. The initial SPA does not require the server artifacts at runtime.

On Vercel, use `apps/web` as the root directory and the TanStack Start framework preset. Nitro detects Vercel and generates `.vercel/output` with server routing and static assets. Leave the build command and output directory at their framework defaults.

GitHub Actions is configured to check and build on Windows, Linux, and macOS. Only local Windows verification has been performed so far.

Browser persistence uses SQLite WASM in a worker and OPFS, with Web Locks coordinating tabs. Legacy IndexedDB projects, media, assets, and segments, plus localStorage preferences, migrate without deleting originals. OPFS failures block saving visibly. See [SQLite migration and verification](docs/verification/sqlite-migration.md) for checks and browser limits.

Use **Filmora folder** to import an unpacked `.wfp.dir`, a folder containing
`ProjectFolder`, or `ProjectFolder` itself. **Open project** still accepts zipped
`.wfp` files. Imports now preserve timeline markers, linked picture/sound,
overlapping clips on extra tracks, picture animation, shared colour looks and
audio fades. Source media remains offline until relinked. Speech defaults to
-20 LUFS; the desktop CLI's `import-filmora --keep-levels` preserves Filmora's
levels. See [supported mappings and verification](docs/verification/filmora-118-03-07.md).

Filmora imports also map transitions, titles and visible nested-template layers
and sounds, with warnings for approximations. Desktop status/media queries now
report renderer caches, jobs, queued exports and missing fonts. Timeline queries
include settings, transitions, summaries and cached words. Agent edits remain
pending in status until **Mark agent edits reviewed** is used in the editor;
acknowledgment survives restart and does not change the project revision. See
[verification and limits](docs/verification/filmora-queries.md).

Clips queries accept track IDs, names and complete display labels. Diff/restore
support revision aliases and the durable reviewed baseline. Join previews list
linked pairs and every skipped cut. Transcription waits return finished/pending
work and keep jobs running after a deadline. Windows Electron also verifies
first-run local Whisper acquisition. See [query/history evidence and limits](docs/verification/query-history.md).

Cards can insert in speech pauses and add locally available whooshes in the same
undo step. Desktop exports support the reference 4K HEVC and 1080p presets.
Loudness can compare rendered audio with its gain lane. Validate returns `ok`;
check scans model problems, frames, speech cuts, pending edits, dead air and screen
recordings. See [render/review verification and limits](docs/verification/render-review.md).

Comments include nearby cached speech. Sync can align short recordings by sound
and save camera picture-delay defaults. Watch replays recent changes; waits can
schedule analysis and observe API exports. Archive supports folder copies,
consolidation, dry runs and optional browser caches. See
[comments/jobs/archive verification and limits](docs/verification/jobs-archive.md).

Resource and asset service adapters now support folder relink plans, complete effect catalogues, provider status, reference search defaults and cached fetches. See [verification and compatibility limits](docs/verification/resources-assets.md).

Asset actions include timeline placement with atomic undo, current licence credits, generation recovery and the pinned 90-asset starter catalogue. See [asset-action verification and limits](docs/verification/asset-actions.md).

CLI status, media, timeline, transcript and search now default to readable output; add `--json` for automation. Positional speech queries and `transcript ID --make` are supported. See [CLI query verification and limits](docs/verification/cli-queries.md).

CLI pauses, tighten, join, captions and short now have readable previews and native flag mappings. Editing requires `--apply`; short copies retain their media within the same profile. See [helper verification and limits](docs/verification/cli-helpers.md).
