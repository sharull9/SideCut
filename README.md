# SideCut

Foundation for a browser-first video editor with an optional desktop application.
The editing engine, desktop app, and agent tools are planned in [the architecture plan](docs/monorepo-plan.md).
The editor has resizable panels, editable sequence properties, browser autosave,
project open/download, and a local media bin. Timeline editing is planned in later phases.

The [Tandem parity roadmap](docs/tandem-parity-roadmap.md) breaks the editor, media,
desktop, and agent work into small phases with acceptance checks and a pinned
upstream feature inventory. Phases 001-018 are implemented: synthetic reference
fixtures, exact flick timing, a browser media feasibility probe, and Effect schemas
for projects, tracks, media, and clips, project validation, atomic command batches,
undo/redo, a resizable editor frame, sequence properties, project persistence,
single-writer browser tabs, and local media registration/import. Five edit commands
are implemented: `updateProject`, `updateSettings`, `addMedia`, `updateMedia`, and
`removeMedia`. Undo history remains in memory and resets on reload.

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
- `packages/contracts`: portable Effect project schemas and exact `bigint` flick timing. The current decoder supports schema version 2. Older-schema migration is planned in phase 046.
- `packages/core`: portable project validation and a synchronous atomic coordinator with revision checks, idempotency, subscriptions, and labelled undo/redo.
- `packages/platform-browser`: IndexedDB project/resource storage, Web Locks writer ownership, save serialization, and local media analysis through MediaBunny. The web session connects this adapter to the portable coordinator.

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

`vp run build` generates the client under `apps/web/dist/client`, including `_shell.html`. Serve that directory and rewrite unmatched application routes to `_shell.html` while serving existing assets normally. Start also produces server build artifacts, but the initial SPA does not require them at runtime.

GitHub Actions is configured to check and build on Windows, Linux, and macOS. Only local Windows verification has been performed so far.
