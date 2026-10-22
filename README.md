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
upstream feature inventory. Phases 001-066 have implementations, with phase 028's
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
fractional crop, opacity, and picture keyframes, plus one unprocessed audio source
at a time. Color adjustment, HSL, color wheels, LUTs, and vignette render in both
preview and export. Sharpen, blur, pixelate, borders, rounded corners, and shadows
also render. Transitions, audio processing, and mixing remain planned. Split with Ctrl/Cmd+K or
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
preserves the reference cutout/shadow settings. Shadows render; cutout processing
is still planned and enabled cutout settings block rendering.
Reset layout to full removes those settings. Select source region opens an
original-source preview with drag selection and numeric coordinates. Zoom can be
immediate or animated from the playhead.

Keyframes support transform, opacity, crop, gain, and existing effect parameter
paths, with add/update/remove and previous/next navigation. Times are relative to
the selected clip. Picture and supported color-effect keys render in preview/export.
Sound and other effect keys remain stored for their later renderers. Motion presets generate full-clip zooms
and pans with linear position/scale keys and an amount from 1 to 3.

The Effects inspector adds, enables, reorders, resets, and removes effects using
registry defaults and ranges. Color wheels support pointer dragging, arrow keys,
and numeric entry. Apply parameters saves the draft; Reset effect removes the
effect and its keys. Media looks precede clip color and spatial effects. Crop is
followed by rounded corners, border, transform, shadow, and group opacity. Each
style uses its first enabled instance, independent of its position in the stack.
Style effects in media looks are ignored, as in the reference. Spatial sizes marked
px@1080 follow the output short side; sharpening follows source resolution.
Borders provide a colored backing behind transparent image holes. Cutout-following
outlines remain dependent on the later cutout renderer.
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

Projects and imported source files persist in IndexedDB for this browser profile
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

The development server starts at http://127.0.0.1:3000. An occupied port may cause Vite to select another; use the URL it prints.

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
- `packages/platform-browser`: IndexedDB project/resource storage, Web Locks writer ownership, save serialization, local media analysis/decoding through MediaBunny, and playback-clock mapping. The web session connects this adapter to the portable coordinator. Zustand owns transient view state in the workspace module.

The desktop renderer will use web presets; its host process will use desktop presets. Node globals are excluded from browser TypeScript programs. Browser lint rules prohibit direct host API imports.

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

## Static hosting

`vp run build` uses Nitro to package TanStack Start. For static hosting, serve `apps/web/.output/public` and rewrite unmatched application routes to `_shell.html` while serving existing assets normally. The initial SPA does not require the server artifacts at runtime.

On Vercel, use `apps/web` as the root directory and the TanStack Start framework preset. Nitro detects Vercel and generates `.vercel/output` with server routing and static assets. Leave the build command and output directory at their framework defaults.

GitHub Actions is configured to check and build on Windows, Linux, and macOS. Only local Windows verification has been performed so far.
