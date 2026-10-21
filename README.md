# SideCut

Foundation for a browser-first video editor with an optional desktop application.
The editing engine, desktop app, and agent tools are planned in [the architecture plan](docs/monorepo-plan.md).
The current UI is the generated starter, organized into a workspace feature module.

## Development

Use Node.js 24.18 or a newer Node 24 release. pnpm is pinned in `package.json`.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

The development server starts at http://127.0.0.1:3000. An occupied port may cause Vite to select another; use the URL it prints.

```sh
pnpm check
pnpm build
```

`check` runs format checking, Oxlint, TypeScript checks, and Vitest. There are no application tests yet; the test command accepts an empty suite while the foundation is being established. Type checking generates TanStack routes first, including on clean checkouts.

`pnpm format` writes formatting, and `pnpm lint:fix` applies lint fixes. Vite+ owns Vite, Oxlint, Oxfmt, Vitest, and workspace task execution. Effect 4 is installed in the web app for the upcoming runtime and schema modules.

## Workspace layout

- `apps/web`: TanStack Start in SPA mode, TanStack Router, and feature modules under `src/modules`. Routes compose features.
- `packages/ui`: generated shadcn components, shared styles/fonts, and the template's `cn` utility.
- `packages/config`: TypeScript, Oxlint, and Oxfmt presets. Each family exports `base`, `web`, and `desktop` entry points.

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

## UI components

Created with shadcn preset `b7kBsBkh7b`: Nova/Base UI, green theme, Remix Icons, Geist Mono, and Instrument Sans headings.

```sh
pnpm dlx shadcn@latest add <component> -c apps/web
```

The app and UI aliases direct shared components into `packages/ui`. The generated `cn` helper currently re-exports the `cn` package; reuse it rather than adding another helper.

## Static hosting

`pnpm build` generates the client under `apps/web/dist/client`, including `_shell.html`. Serve that directory and rewrite unmatched application routes to `_shell.html` while serving existing assets normally. Start also produces server build artifacts, but the initial SPA does not require them at runtime.

GitHub Actions is configured to check and build on Windows, Linux, and macOS. Only local Windows verification has been performed so far.
