# SDK workflow acceptance: phase 132

The TypeScript client supports the pinned SDK's read/plan/edit pattern over SideCut's existing owner. Reference: `sdk/tandem.ts`, `sdk/types.ts` and `sdk/examples/fix-captions.ts` at `735a9b8e162c1f951044baa892d94993869f2e77`. This ports the workflow and helpers, not every upstream runner or result shape.

Build the Node entry before running scripts:

```powershell
vp run --filter @sidecut/client build
```

The workspace entry `@sidecut/client` remains TypeScript for bundlers. The built Node entry is `@sidecut/client/node` (or `packages/client/dist/node.mjs` when importing by path). It uses the existing CLI's project/discovery/ownership rules. It never starts or releases a coordinator. The SDK stays private; no package was published.

```javascript
import { openProjectClient, cmd, fixCaptionWords } from "./packages/client/dist/node.mjs";

const t = await openProjectClient("C:/video/current.tandem", {
  endpointFile: "C:/profile/current.tandem.api.json",
  author: "caption-script",
});
const p = await t.project();
const { commands, changes } = fixCaptionWords(p, { comics: "Convex" });
const result = await t.edit("Correct captions", commands, {
  idempotencyKey: crypto.randomUUID(),
});
console.log({ changes, result });
```

`cmd` builders derive their argument types from the authoritative command body's JSON input schema. Seconds stay JSON numbers; callers do not have to construct decoded `Time` objects. Request types cover signed integers, scalar/list selectors, string maps and segment fields in addition to primitive/time/command fields. Segment field types reuse the core model.

`project()` validates and normalizes the returned project with the authoritative project schema. `ProjectView` provides `track`, `clips`, `clip`, `at`, `transitions`, `captions` and `media`. Its `json` and clip helpers expose seconds. `at()` respects visual track order and excludes disabled clips. Media suffix lookup matches complete path components. Caption replacement updates text, timed words and names, preserves punctuation, joins matched word timing, and returns commands without changing the view.

`status`, `transcript`, `history`, `timelineText`, `schema`, `media`, `search`, `pauses`, `check`, `frame`, `frames`, `clip`, `findWords` and `undo` provide convenience calls. `history()` uses host journal edits when its native-style events list is empty. Stateful regexes in `findWords` are copied/reset so repeated words match and caller state is preserved.

The client tracks the last non-dry-run revision. `edit()` requires a prior read or an explicit revision, dry-runs by default, and applies the exact same batch with that revision. `dryRun:"only"` stops after preview; `dryRun:false` skips preview; an empty command list makes no request. A failing preview or conflict prevents the apply. The method returns a compact count/ID/warning summary. `apply(commands, options)` remains available for explicit revision/key control. Retain the same commands, revision and idempotency key for an ambiguous completion; no automatic retry occurs.

Configured authors are sent as JSON only to operations that declare an author field; explicit request authors override them. This supports Unicode names and avoids HTTP header encoding limits. Node discovery uses `author`, then `SIDECUT_AUTHOR`, `TANDEM_AUTHOR`, or `sdk`. Malformed discovery and host JSON errors do not echo their contents. Abort signals reach requests. HTTP failures retain service codes and conflict revisions.

Verification:

- Client unit/integration tests use real HTTP owners for dry-run/apply ordering, atomic failure, competing edits, Unicode attribution, one-step undo, idempotent retry after a lost commit reply, owner mismatch, malformed discovery, decoding and cancellation. Type assertions cover JSON command times and newly supported request field kinds.
- Project-view tests cover lookup, stacking, timing, schema errors, timed/untimed caption replacement and unchanged input data.
- `tests/desktop/verify-sdk.mjs` runs the built SDK in separate Node subprocesses against the real Electron/browser project owner. It confirms a timed caption correction appears in the UI at the same revision; writes a 320x180 PNG, two-frame 216x98 contact sheet and 0.3-second MP4; runs a quick check; rejects a competing stale edit; and undoes both edits visibly. [Runtime evidence](sdk-runtime.json).

Run runtime acceptance after building the SDK and desktop, with the web dev server at `127.0.0.1:4270`:

```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
vp exec --filter @sidecut/desktop electron ../../tests/desktop/verify-sdk.mjs
```

The runtime is Windows development Electron. Result decoding covers project/status/apply/transcript/history/timeline text; other raw service results remain `unknown`. The upstream Bun script runner, inline globals, automatic headless serving and every convenience/result type are not reproduced. Existing renderer, provider, native installation and output path limits still apply.
