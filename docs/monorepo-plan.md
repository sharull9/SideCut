# SideCut monorepo plan

Status: monorepo foundation implemented. The selected shadcn/TanStack Start template, shared UI, single config package, and Effect dependency are in place. Media editing, desktop packaging, and agent integration remain future phases.

## Requirements and decisions

- Build a Tandem-style video editor that people and agents can edit through the same command system.
- The hosted browser app must work without installing an application or running a local server.
- Media stays on the user's device. Cloud storage and processing are optional future work.
- Offer an optional Electron desktop app for Windows, macOS, and Linux.
- Use React, TypeScript, Vite, TanStack Start, TanStack Router, Effect, and shadcn/ui.
- Start from the user's shadcn monorepo command and preset `b7kBsBkh7b`; retain the generated UI, theme, and `cn` utility.
- Keep TypeScript, lint, and formatter policies in one extensible workspace package, `@sidecut/config`, with independent subpath exports.
- Interpret "Lite OXC" as Oxlint for linting and Oxfmt for formatting.
- Use `vp` for installs, dependency management, tool execution, and workspace tasks. Retain pnpm workspaces and the lockfile as Vite+'s underlying package-management format. Vite+ includes Vite, Vitest, Oxlint, Oxfmt, packaging tools, and a workspace task runner. It satisfies the Vite requirement without adding Turborepo alongside another task runner.
- The product is SideCut and workspace packages use the `@sidecut/*` namespace.

The browser and desktop share one editor interface, project schema, edit semantics, and render planning. Their storage and media implementations differ. Browser installation as a PWA is optional and separate from installing the Electron desktop app.

## What the T3 Code inspection established

Inspected the cached `pingdotgg/t3code` checkout at commit `54084ae1e6c32809db040e4fa571c80fdf2d8ae4`, dated 2026-10-01. Attempted `git pull --ff-only`, but the refresh stalled and was stopped. Findings below are pinned to that inspected revision, not a claim about the latest main branch.

Useful source references:

- [Workspace and catalog](https://github.com/pingdotgg/t3code/blob/54084ae1e6c32809db040e4fa571c80fdf2d8ae4/pnpm-workspace.yaml): pnpm workspaces, centralized dependency versions, and explicit native dependency build permissions.
- [Root scripts](https://github.com/pingdotgg/t3code/blob/54084ae1e6c32809db040e4fa571c80fdf2d8ae4/package.json) and [root tooling config](https://github.com/pingdotgg/t3code/blob/54084ae1e6c32809db040e4fa571c80fdf2d8ae4/vite.config.ts): Vite+, repository lint and formatting policy, and workspace commands.
- [Client runtime](https://github.com/pingdotgg/t3code/blob/54084ae1e6c32809db040e4fa571c80fdf2d8ae4/packages/client-runtime/package.json): shared client behavior behind explicit package subpath exports.
- [Contracts](https://github.com/pingdotgg/t3code/tree/54084ae1e6c32809db040e4fa571c80fdf2d8ae4/packages/contracts): typed boundaries between clients and host services.
- [Web app](https://github.com/pingdotgg/t3code/tree/54084ae1e6c32809db040e4fa571c80fdf2d8ae4/apps/web) and [desktop preload](https://github.com/pingdotgg/t3code/blob/54084ae1e6c32809db040e4fa571c80fdf2d8ae4/apps/desktop/src/preload.ts): a React/Vite interface with a typed Electron bridge.
- [TypeScript base](https://github.com/pingdotgg/t3code/blob/54084ae1e6c32809db040e4fa571c80fdf2d8ae4/tsconfig.base.json): strict defaults and per-runtime overrides.

Take the separation of applications and shared packages, explicit contracts, narrow desktop bridge, centralized versions, and one shared UI. Keep service methods independent of IPC, HTTP, or MCP handlers.

Adapt rather than copy these choices:

- T3 keeps shadcn components in `apps/web/src/components/ui`. This project will own them in `packages/ui`, as requested.
- T3 keeps much tooling policy at the root. This project will extract reusable presets into packages and compose them at the root.
- T3's hosted client connects to a running environment/server. Our hosted editor must have its own local browser runtime.
- Adopt Effect for typed services, lifecycle management, and schemas. Keep T3's provider orchestration, SSH, tunnels, mobile apps, and project-specific lint policies out of the initial editor.

## Selected scaffold and preset

Use the supplied command when implementation begins:

```sh
vp dlx shadcn@latest init --preset b7kBsBkh7b --template start --monorepo
```

Checked with the CLI on 2026-10-21 using `preset decode` and `init --help`, then generated during foundation implementation with the supplied options. The first parallel CLI checks collided in pnpm's temporary package store; sequential retries succeeded.

The decoded preset is Nova, zinc base, green theme, zinc charts, Remix Icons, Geist Mono body font, Instrument Sans headings, medium radius, subtle menu accent, and inverted-translucent menu color. Preserve these choices rather than introducing the previously proposed Lucide icon set. Use the generated component base and aliases as the source of truth; the decoded preset does not itself report the primitive base.

The scaffold is the starting point, not a second independently maintained app. Inspect the generated manifest/configuration before adapting it to the planned package boundaries. Consolidate generated TypeScript/lint/format configs into `packages/config`, reuse `packages/ui`, and preserve its `cn` implementation. If the generated monorepo contains Turborepo or other formatting/lint tools, migrate their actual tasks to Vite+ and remove the redundant tools only after equivalent commands pass. Verify TanStack Start's generated Vite plugin setup against the selected Vite+ release; do not replace generated framework plugins blindly.

shadcn documents that `init` adds the `cn` utility, and the monorepo convention exports it from the UI package. Use that generated helper for application imports rather than implementing another `cn` or a separate utilities package. Its `clsx`/`tailwind-merge` dependencies remain wherever the generated helper needs them; consuming app modules import `cn`, not those implementation dependencies directly. [CLI](https://ui.shadcn.com/docs/cli), [monorepo utilities](https://ui.shadcn.com/docs/monorepo).

## Proposed file structure

This is the intended structure as functionality lands. Packages and applications marked later are added with their first real implementation, not as empty placeholders.

```text
.
|-- apps/
|   |-- web/                         # TanStack Start app, hosted or desktop renderer
|   |   |-- src/
|   |   |   |-- app/                 # Bootstrap, router, providers, runtime selection
|   |   |   |-- modules/
|   |   |   |   |-- projects/
|   |   |   |   |-- media-library/
|   |   |   |   |-- timeline/
|   |   |   |   |-- preview/
|   |   |   |   |-- inspector/
|   |   |   |   |-- export/
|   |   |   |   `-- settings/
|   |   |   |-- routes/              # TanStack file routes, not editing logic
|   |   |   |-- router.tsx           # Router creation and typed context
|   |   |   |-- routeTree.gen.ts     # Generated, never manually edited
|   |   |   `-- styles/              # App layout styles; shared tokens come from ui
|   |   |-- public/                  # Manifest and icons when PWA support lands
|   |   |-- components.json
|   |   |-- vite.config.ts
|   |   |-- tsconfig.json
|   |   `-- tsconfig.node.json       # Vite config and build tooling
|   |-- desktop/                     # Later: Electron shell, no duplicate editor
|   |   |-- src/
|   |   |   |-- main/                # Windows, menus, project service, lifecycle
|   |   |   |-- preload/             # Narrow typed contextBridge API
|   |   |   `-- workers/             # Native media worker entry point
|   |   |-- resources/
|   |   |-- vite.config.ts
|   |   |-- tsconfig.main.json
|   |   `-- tsconfig.preload.json
|   `-- agent/                       # Later: CLI and stdio MCP entry points
|-- packages/
|   |-- config/                     # One workspace package: @sidecut/config
|   |   |-- typescript/
|   |   |   |-- base.json
|   |   |   |-- web.json
|   |   |   `-- desktop.json
|   |   |-- oxlint/
|   |   |   |-- base.ts
|   |   |   |-- web.ts
|   |   |   `-- desktop.ts
|   |   |-- oxfmt/
|   |   |   |-- base.ts
|   |   |   |-- web.ts
|   |   |   `-- desktop.ts
|   |   `-- package.json
|   |-- ui/
|   |   |-- src/
|   |   |   |-- components/          # Owned shadcn source files
|   |   |   |-- hooks/
|   |   |   |-- lib/utils.ts         # Reuse the template's generated cn helper
|   |   |   `-- styles/globals.css   # Tokens, shared theme, Tailwind setup
|   |   `-- components.json
|   |-- contracts/src/              # JSON schemas, commands, events, capabilities
|   |-- core/src/                   # Pure timeline model, edits, validation, undo
|   |-- client-runtime/src/         # Sessions, subscriptions, actions, service ports
|   |-- platform-browser/src/       # File access, IndexedDB/OPFS, browser lifecycle
|   |-- render-core/src/            # Later: pure render plan, time and layer mapping
|   |-- media-browser/src/          # Later: codecs, demux/mux, compositor, workers
|   |-- platform-desktop/src/       # Later: renderer-side typed IPC adapter only
|   `-- media-native/src/           # Later: Node-side probing/proxy/export jobs
|-- tests/
|   |-- fixtures/                   # Tiny synthetic audio/video and project fixtures
|   `-- e2e/                        # Browser and desktop user journeys
|-- scripts/                        # Cross-platform Node build/release scripts
|-- docs/                           # This plan and decisions that need explanation
|-- .github/workflows/
|-- package.json
|-- pnpm-workspace.yaml
|-- pnpm-lock.yaml
|-- vite.config.ts                  # Composes shared lint, fmt, test, task settings
`-- .editorconfig
```

Each app and code package also has `package.json`, a runtime-appropriate `tsconfig`, and explicit exports where applicable. `apps/web/src/modules/<feature>` contains `components/`, state/hooks, and feature tests as needed, with a small public entry point. Avoid creating every subfolder until it has content.

## Dependency and module rules

- `contracts` uses Effect Schema for validated project/command/event data and inferred types. No React, Node, Electron, DOM, or media backend dependencies. Effect is a portable dependency; never expose live Effect values, fibers, or service objects as wire data.
- `core` depends on contracts. It implements deterministic command application, validation, revisions, idempotency, undo, and project migration. It imports no platform APIs.
- `render-core` depends on the project model and produces a backend-neutral render plan. It contains no browser or native renderer.
- `client-runtime` depends on contracts/core and defines Effect services for project storage, project sessions, media jobs, and capabilities. Browser and desktop provide their implementations through layers. Feature modules call these services rather than reaching into filesystem or codec APIs.
- Browser and desktop adapters implement those interfaces. Browser entry points must never import Electron or Node modules, even indirectly through a convenience barrel.
- `ui` depends on React and UI primitives only. It knows nothing about projects, clips, agents, or media processing.
- `web` composes UI, feature modules, client runtime, and the selected adapter. Desktop loads the built web renderer rather than implementing another editor.
- Packages import other packages through declared `workspace:*` dependencies and explicit exports. No cross-package `../../src` imports or repository-wide TypeScript path aliases that bypass package exports.
- Extract additional packages when code needs a distinct runtime, dependency boundary, or consumer. Keep ordinary editor features as modules in the web app.

## Browser and desktop behavior

### Browser, without installation

Serve `apps/web` over HTTPS. Opening the URL is enough to create a project, select local media, edit, save, and export a supported format. No native companion or account is required.

Use TanStack Start's SPA mode and TanStack Router's file-based routes for the initial editor. The build may prerender an application shell, but runtime editing must not depend on Start server functions, server routes, or an SSR service. Browser file access, IndexedDB, OPFS, workers, and the local Effect runtime initialize on the client, not at module import or during shell prerendering. Configure static-host deep-link rewrites and later the desktop packaged origin to resolve the same routes. Start server functionality remains available for optional cloud features. [SPA mode](https://tanstack.com/start/latest/docs/framework/react/guide/spa-mode).

- Use file input and drag/drop as the baseline. Use directory/file handles where supported, with permission-aware reopen and relink flows.
- Persist project records in IndexedDB and caches/proxies in OPFS where available. Store durable media identifiers separately from transient object URLs and desktop absolute paths.
- Retain supported file handles or offer an explicit copy into managed storage. When media cannot be retained, explain that users must reselect it after reload. Browser storage is subject to quota and eviction, so project archive/download is a first-class action.
- Use workers for expensive media jobs. Evaluate WebCodecs plus Mediabunny for decoding, encoding, and container I/O. WebCodecs alone does not demux or mux files.
- Start with a small shared compositor and render plan for both preview and export, plus Web Audio for playback/mixing. Bound decoded-frame caches and stream output rather than buffering entire long videos in RAM.
- Detect actual codecs and APIs at runtime. The first supported editing baseline is desktop Chromium. Test Firefox and Safari explicitly and display useful unsupported-format or capability messages. Do not advertise full browser or codec parity before verification.
- An optional PWA manifest/service worker adds installability and cached application assets. It does not grant native codecs or unrestricted disk access. Keep first-visit network requirements and update behavior explicit.

### Optional desktop installation

Electron packages the same web renderer plus a host project service and isolated native media jobs. Load packaged application assets. Keep context isolation and sandboxing enabled, disable renderer Node integration, and expose only validated project/media operations through preload.

Use native filesystem access and watchers, durable project folders, native probing/proxies, and additional export codecs. Reuse the browser preview/render path initially to reduce visual differences. Evaluate a broader native composition engine only when measured requirements justify it; MLT is not required for the initial browser-first architecture.

`media-native` is host-only. It must not enter the renderer bundle. Long jobs run outside the Electron main/UI threads and report progress, cancellation, and failures through typed events.

Browser data and Electron data are separate storage areas. Moving work between them uses project export/import or an archive containing media. Optional cloud sync can remove that manual step later; installing the app alone does not synchronize browser storage.

### One authority for edits

Within a browser session, one project service serializes edits and persists journal/snapshots; coordinate multiple tabs with a single-writer lock and expose read-only/recovery behavior on contention.

On desktop, the host project service owns the coordinator. Renderer actions and later CLI/MCP requests reach that same service. They must not mutate independent copies. Commands include an expected revision and idempotency key; changes publish revisioned events/snapshots.

Each running host/session owns an appropriately scoped Effect runtime and releases it on shutdown. Effect manages job concurrency, typed failures, cancellation, streams of progress, and resource cleanup. Cancelling an Effect must also invoke the real decoder, worker, or child-process cancellation/cleanup operation; interrupting a fiber alone is insufficient. Retry only explicitly safe operations; mutation retries must preserve idempotency. Keep reducer/timeline mathematics deterministic and independent of live services. Convert typed errors to stable serializable errors at IPC/worker/MCP boundaries. Avoid creating a new runtime for every component render or edit.

Zustand remains limited to transient UI state. It subscribes to session snapshots through the client runtime and does not become another Effect service registry or project coordinator.

The standalone browser cannot directly run stdio MCP servers or local agent CLIs. A browser-side agent can submit typed commands to its session. External agent integration arrives through the installed host or a future explicitly connected remote service. Ordinary browser editing remains independent of either.

### Project compatibility

Preserve Tandem's versioned JSON format where practical, starting with an explicit supported subset. Reject unsupported schema versions and report unsupported effects rather than silently dropping data. Test imports against committed fixtures.

Keep time calculations exact. Decide the internal integer/rational representation before porting Swift's Int64 flick arithmetic; JavaScript numbers and JSON do not provide arbitrary Int64 precision, and JSON cannot serialize bigint directly. Wire conversion must preserve documented timing semantics.

## Shared TypeScript configuration

One private ESM workspace package, `@sidecut/config`, owns all three tooling families. It exposes explicit subpaths without a root barrel or application runtime dependencies. It is a development dependency of consumers, not part of the shipped editor bundle.

Example consumer paths:

```text
@sidecut/config/typescript/base.json
@sidecut/config/typescript/web.json
@sidecut/config/typescript/desktop.json
@sidecut/config/oxlint/base
@sidecut/config/oxlint/web
@sidecut/config/oxlint/desktop
@sidecut/config/oxfmt/base
@sidecut/config/oxfmt/web
@sidecut/config/oxfmt/desktop
```

Consumers use TypeScript `extends`, for example `@sidecut/config/typescript/web.json`. Within the config package, web and desktop presets extend `./base.json`. Export each JSON file and TS config module explicitly in `package.json`.

- `base.json`: strict mode, unchecked indexed access checks, exact optional properties, override checks, consistent casing, verbatim module syntax, isolated modules, no emit, neutral ECMAScript libraries, and `types: []`. Use bundler resolution for internal source-consumed libraries. Pick a compatible pinned TypeScript/Vite toolchain at implementation time.
- `web.json`: extends base with the React JSX runtime and DOM libraries. Used by the web app, shared UI, and desktop renderer.
- `desktop.json`: extends base with NodeNext module/resolution and explicit Node types. Used by desktop host code, build scripts, and later the CLI. Electron-specific types belong in the actual Electron entry-point configs, not in this reusable Node preset. Package formats and build output extensions must match it.
- Worker entry points extend base and set WebWorker libraries in their own TS program. Do not mix DOM-window and WebWorker globals. Add a shared worker preset later only if several consumers need it.
- Desktop main/preload have separate configurations. The web app's Vite config extends the Node-oriented desktop preset in its tooling config rather than leaking Node types into application code.

Use source exports for private packages consumed by Vite/Vitest and bundle Node entry points. Each package declares every directly imported dependency, including config packages. If the CLI/SDK becomes independently distributable, add a proper JS/declaration build and release exports then.

Vite transpilation does not replace type checking. CI runs the workspace TypeScript checks separately. Start with per-package no-emit checks; add project-reference build machinery only if measured check time warrants it.

## Shared Oxlint and Oxfmt configuration

`@sidecut/config/oxlint/base` exports common correctness and import-boundary policy. The `web` preset composes base with React, browser, and accessibility rules; `desktop` composes base with host/Node rules. A desktop renderer consumes the web policy. The root `vite.config.ts` composes these objects into Vite+'s `lint` block with workspace-relative file overrides. Additional packages can extend the presets without copying rules. Ensure the selected Vite+ version's config types match the exported object shapes.

Enforce correctness, React hooks, JSX accessibility, consistent type imports, and the browser/native import boundary. Add shadcn lint rules once their support for the selected shared UI import paths is verified. Do not inherit T3-specific rule exceptions or custom plugins wholesale.

`@sidecut/config/oxfmt/base` exports a plain formatting options object for Vite+'s `fmt` block. Use two spaces, semicolons, double quotes, trailing commas, and a 100-character print width as initial defaults. The `web` and `desktop` entry points initially re-export base, preserving the requested extension points without introducing different formatting styles. Consumers can compose a real override when needed. This is object composition, not an assumed JSON `extends` capability in Oxfmt.

Keep repository-specific ignores in the root configuration: build outputs, generated routes/schema files, coverage, caches, native binaries, and the lockfile where appropriate. Apply the same policy to apps, packages, scripts, docs, and CI-owned source formats supported by the formatter. A package has no separate formatter configuration unless it has a real exception.

Root commands will include:

- `dev` and `dev:desktop` for the two launch modes.
- `build`, `build:web`, and `build:desktop` with dependency ordering.
- `typecheck`, `lint`, `lint:fix`, `format`, `format:check`, `test`, and `test:e2e`.
- `check` as the CI aggregate. Formatter checks never rewrite files in CI.

Use Vite+'s workspace runner and caching. Track shared config files as task inputs, keep dev/watch tasks uncached, and keep signing secrets out of cached outputs. Use Node scripts rather than Unix-only shell chains so development works on Windows.

## shadcn/ui ownership

Use `packages/ui` as the single owner of shadcn components and shared styles. Set up `components.json` in the web app and UI package with matching preset/base/icon settings and aliases targeting `@sidecut/ui` exports. Tailwind must scan both the app and UI package sources.

Use the component base produced by the selected preset/template and verify it in generated `components.json`. Keep preset `b7kBsBkh7b` consistent across app and UI package. Import concrete subpaths such as `@sidecut/ui/components/button`, `@sidecut/ui/lib/utils`, and `@sidecut/ui/styles/globals.css`.

Use shadcn controls for dialogs, menus, command palette, sliders, tabs, tooltips, progress, forms, and resizable panels. Timeline tracks, waveform drawing, and the video compositor remain editor-specific code. Shared component styling uses semantic tokens and variants; feature layout remains inside feature modules.

## Implementation sequence and acceptance criteria

1. **Media feasibility probe.** Validate local browser import, accurate seeking, camera overlay, synchronized audio, and short export using the proposed browser stack. Check variable frame rate, cancellation, and bounded memory with synthetic fixtures. Establish the first codec/browser baseline before committing to the engine. No cloud upload or native installation may be required.
2. **Monorepo foundation.** Generate the selected shadcn/TanStack Start monorepo, preserve its UI/preset/`cn`, consolidate configs, and adapt tasks to Vite+. Add pnpm catalog, Effect/Schema, and only the domain/runtime packages needed by the first vertical slice. Verify Start SPA shell generation, generated route types, and an Effect client lifecycle. A clean Windows checkout must install, launch, format-check, lint, typecheck, test, and build; CI also verifies Linux and macOS.
3. **Project and editing core.** Implement schema, persistence, import/relink, serialized commands, revision checks, undo, and safe timing representation. Prove rejected batches do not partially mutate the project and reload restores saved work.
4. **Browser editor slice.** Build media bin, timeline trim/split, preview, audio, and one supported export path. A user can finish a short edit at a hosted URL without installing anything. Unsupported media has an actionable result, and source files are not uploaded.
5. **Desktop shell.** Package the shared renderer, typed bridge, filesystem storage, and native jobs. Verify import/edit/reopen/export on Windows, macOS, and Linux, plus browser-to-desktop archive round trips. Establish preview/export parity tests and packaging/signing steps.
6. **Agents and optional install polish.** Add CLI/MCP adapters to the desktop project service, test concurrent human/agent revision conflicts, then add PWA offline/update flows. PWA installation must remain optional.
7. **Optional cloud.** Only after a separate product decision, add server/worker applications, authentication, object storage, and upload consent. Reuse contracts and render plans; keep local editing independent. Cloud accounts, collaboration, and billing are not part of the foundation.

Testing should cover observable behavior: atomic edits and undo, timing, persistence/relink, worker cancellation, preview/export consistency, and one complete editing/export journey per runtime. No tests that merely assert the directory tree or repeat configuration literals.

## Proposed tools and external packages

This is the proposed direct-dependency/tool inventory, not a lockfile or a claim that every package is already selected by a working prototype. Add each dependency when its feature lands. Pin compatible versions in the pnpm catalog during implementation. Packages installed by the shadcn generator depend on the components and preset selected.

### Foundation and browser editor

- **Node.js LTS and pnpm:** development runtime, workspace management, lockfile, and version catalog. End users opening the website need neither.
- **`typescript`, `@types/node`, `@types/react`, `@types/react-dom`:** type checking and runtime-appropriate declarations. Keep Node globals out of browser programs.
- **`vite-plus` and `@vitejs/plugin-react`:** Vite development/build and React integration. Vite+, through `vp`, supplies the workspace task runner, Vitest, Oxlint, Oxfmt, and Node bundle tooling. Avoid a second independent Vite/test/lint/formatter toolchain. Declare any directly imported tool packages according to the pinned Vite+ release's requirements rather than relying on transitive dependency hoisting.
- **`react`, `react-dom`:** editor interface and shared components.
- **`@tanstack/react-start`, `@tanstack/react-router`, and generated routing/build integrations:** Start scaffold, file-based project/editor/settings navigation, typed route context, and SPA shell. Preserve the scaffold's devtools/build packages only where used; ensure generated route types are available before typechecking a clean checkout. [Start SPA mode](https://tanstack.com/start/latest/docs/framework/react/guide/spa-mode)
- **TanStack Router search parameters:** typed media filters, active inspector tab, and explicit deep links using route search validation and router navigation. Use pure Effect Schema decoding in `validateSearch`, with inferred output types. URLs contain only appropriate identifiers/view state, never absolute media paths, tokens, media content, or per-frame playback updates. Browser-local project links do not transfer media to another device. `nuqs` is removed from the initial stack: its own documentation calls the TanStack Router adapter experimental and says it does not yet cover Start. [Router search parameters](https://tanstack.com/router/latest/docs/framework/react/guide/search-params), [nuqs adapter limitation](https://nuqs.dev/docs/adapters#tanstack-router)
- **`zustand`:** transient editor UI state such as selection, active tool, panel state, and viewport. It is not a second project database or another command coordinator. The project service remains authoritative. Playback clocks and decoded frames stay outside React's render loop. [Zustand](https://github.com/pmndrs/zustand)
- **`effect`, including Effect Schema:** typed service dependencies and failures, scoped resources, job concurrency/cancellation, progress streams, project/command/IPC validation, and derived JSON schemas. Prefer this as the single internal schema system. Add platform/testing integrations only when needed and compatible with the pinned stable Effect major. A third-party SDK may require a small Zod adapter at its boundary; do not duplicate all project schemas in Zod. [Effect](https://effect.website/)
- **`idb`:** a small promise-based IndexedDB wrapper, used only by browser persistence. OPFS remains a platform API for cache/media files. [idb](https://github.com/jakearchibald/idb)
- **`mediabunny`:** browser media container I/O and WebCodecs integration, subject to the media feasibility probe. It does not replace our timeline, compositor, audio scheduling, or command engine. [Mediabunny](https://mediabunny.dev/guide/introduction)

### Shared UI

- **shadcn CLI:** source generator, run only when adding/updating owned components. Not an editor runtime library.
- **`tailwindcss`, `@tailwindcss/vite`:** styles, semantic tokens, and shared UI source scanning.
- **Generated UI primitive dependency:** retain the base selected by the template and verify its actual package from the generated manifest.
- **Generated Remix Icon dependency:** preserve the selected preset's `remixicon` library consistently. Do not add Lucide as a second icon system.
- **Generated `cn` utility:** reuse `packages/ui/src/lib/utils.ts` through `@sidecut/ui/lib/utils`. `clsx` and `tailwind-merge` are its implementation dependencies when generated; there is no additional hand-written helper or application-level class-composition layer. Keep `class-variance-authority` where generated component variants require it.
- **Generated font setup:** retain Geist Mono and Instrument Sans from the preset; avoid replacing their loader or asset setup before inspecting the template output.
- **`tw-animate-css`:** component animation utilities if required by the selected generated styles; honor reduced motion.
- Component-specific dependencies, such as the resizable panel implementation or toast primitives, are accepted from the selected registry component and recorded when generated. Do not add an additional general animation or drag/drop framework before the actual interaction requires it.

### Desktop and agent phases

- **`electron`:** desktop host and renderer runtime.
- **`electron-builder`:** proposed installers, platform resources, signing, and packaging. Use the stable release documentation matching the pinned version. [electron-builder](https://www.electron.build/)
- **FFmpeg and ffprobe:** native executables for probing, conversion, proxies, and native export jobs. Binary distribution, architectures, and included codec licenses must be selected explicitly; an npm binary wrapper is not yet chosen.
- **`chokidar`:** cross-platform project/media directory watching when desktop folder watching lands.
- **Official MCP TypeScript SDK:** stdio MCP integration in `apps/agent`, with its package/API version selected at that phase. Use Node's built-in argument parser for the initial CLI instead of another CLI framework. [MCP server guide](https://modelcontextprotocol.io/docs/develop/build-server)
- **`electron-updater`:** later, if desktop automatic updates are part of the release workflow.

### Verification and delivery

- **Vitest through Vite+:** core, service, adapter, and render-planning tests.
- **`@testing-library/react`, `@testing-library/user-event`, and `jsdom`:** focused UI interaction tests when needed. Actual codecs, storage permissions, and Electron behavior are verified in real runtimes.
- **`@playwright/test`:** browser editing/export journeys and the compatible Playwright Electron driver for desktop integration checks. This is the proposed repository test tooling, separate from the browser tools used for this planning conversation.
- **GitHub Actions:** lockfile-based CI and platform build/test jobs. Signing and publishing require separately configured credentials.
- **`vite-plugin-pwa`:** later PWA manifest/service-worker integration, after the basic browser editing flow works. Cache app assets deliberately; do not silently cache all source media or exported videos.

### Other optional choices

Effect is selected for the foundation. Select a compatible stable major and its matching documentation/integrations during implementation; do not copy the inspected T3 prerelease versions. Its runtime does not replace the media engine or transient UI state.

The following tools remain conditional:

- **TanStack Query:** useful for a future remote/cloud data source; not needed just to wrap local coordinator commands.
- **TanStack Virtual:** add if measurement shows large media/track lists need virtualization.
- **A drag/drop library:** decide during timeline interaction work; avoid assuming list sorting is a video timeline engine.
- **ONNX Runtime Web / whisper.cpp:** candidates for later local cutout/transcription features, after model/runtime benchmarks. Model distribution is a separate decision.
- **FFmpeg WASM:** an optional fallback to evaluate for specific unsupported operations, not the default long-video processing engine.
- **Turborepo, ESLint, Prettier:** not proposed alongside Vite+'s task runner, Oxlint, and Oxfmt.
- **Cloud database, authentication, object storage, and an in-app model SDK:** deferred until those product features are specified. CLI/MCP support does not itself require an in-app model API dependency.

## Remaining choices

- Confirm the first supported browser/codec/export baseline through the media probe.
- Benchmark and select the native export path after the browser slice; broad native feature parity is not assumed.
- The product name is SideCut, the package namespace is `@sidecut/*`, and the visual preset is `b7kBsBkh7b`.
- Verify the generated TanStack Start/Vite plugin configuration against Vite+ and inspect any generated task-runner migration before scaffolding changes are kept.
- Select an explicit policy for retaining large source files in browser-managed storage versus asking users to reselect them.

## Documentation checked

- [Vite+ toolchain](https://viteplus.dev/guide/), [configuration](https://viteplus.dev/config/), and [workspace task runner](https://viteplus.dev/guide/run).
- [Oxlint shared configuration](https://oxc.rs/docs/guide/usage/linter/config.html) and [Oxfmt configuration](https://oxc.rs/docs/guide/usage/formatter/config.html).
- [shadcn monorepo guidance](https://ui.shadcn.com/docs/monorepo).
- [shadcn TanStack Start installation](https://ui.shadcn.com/docs/installation/tanstack), [CLI](https://ui.shadcn.com/docs/cli), and preset decoded through `shadcn preset decode b7kBsBkh7b`.
- [TanStack Start SPA mode](https://tanstack.com/start/latest/docs/framework/react/guide/spa-mode), [Router search parameters](https://tanstack.com/router/latest/docs/framework/react/guide/search-params), and [nuqs adapter constraints](https://nuqs.dev/docs/adapters#tanstack-router).
- [Effect](https://effect.website/) for typed services, structured concurrency, and schemas.
- [WebCodecs](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API), [File System API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API), and [Mediabunny](https://mediabunny.dev/guide/introduction).
- [Electron renderer and bridge guidance](https://www.electronjs.org/docs/latest/tutorial/security).

The foundation is implemented and checked on Windows: format, lint, TypeScript, production SPA build, browser startup, and an Effect runtime/schema smoke check. There are no application tests yet. Browser media editing, desktop builds, and runtime media benchmarks have not been implemented or verified.
