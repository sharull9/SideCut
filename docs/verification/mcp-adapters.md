# MCP adapters: group 131

All 43 tools use the existing desktop services through authenticated HTTP. There is no second edit coordinator. This verifies the portable SideCut adapters, not full upstream feature or rendering parity.

The pinned reference is `735a9b8e162c1f951044baa892d94993869f2e77`. `scripts/capture-mcp-reference.mjs` extracts tool properties, required arguments, defaults and annotations from `MCPServer.swift`. The captured runtime catalogue is `scripts/mcp-tools.json`; `tests/fixtures/tandem/mcp-reference.json` records its hash and compact contracts. Apply uses SideCut's portable command definitions, explicitly identified in both files. The catalogue can be regenerated from the pinned reference checkout without macOS.

The server initializes and lists tools without the desktop. Calls connect lazily. `effects` reads the verified bundled catalogue without a host. Other tools require a running owner. Optional `project` selects a file or folder and verifies its canonical owner before dispatch; a different project uses its existing discovery file. A stale discovery file cannot redirect an edit into the configured project. Closed-project and headless editing remain unsupported.

Every tool accepts `json:true`; readable text is the default and reuses the CLI formatters tested against pinned readable fixtures. Success explicitly returns `isError:false`. Inline PNGs are image blocks first, followed by text metadata with the base64 field removed. File output returns text only. Failures are one plain text block with `isError:true`. Frame has the native `maxWidth:1280` request default; the renderer preserves source dimensions when smaller.

Arguments are checked against closed native tool schemas before dispatch. `json` and `project` are adapter metadata and never reach host validation. Client names supply edit authors, normalizing Claude, Codex, Cursor and Gemini. `--author`, `SIDECUT_AUTHOR` and `TANDEM_AUTHOR` override that attribution. `--endpoint-file` and `--project` configure startup defaults. Explicit input authors retain precedence in services that expose them. Requests are not automatically retried.

Three schema extensions preserve SideCut's guards: `assets_generate.confirmedPaid`, `assets_use.expectedRevision`, and `segments_insert.expectedRevision`. Tool descriptions describe the portable host rather than claiming native-only capabilities. Native annotations are retained as advisory metadata, including helper tools whose `apply` argument controls mutations.

Verification:

- `apps/desktop/src/main/mcp-adapters.test.ts` checks all 43 contracts and their hash, metadata types, defaults, nested command validation, readable fixtures, author selection and image block order.
- `apps/desktop/src/main/mcp.test.ts` uses a real SDK client and stdio subprocess for initialization, inventory, readable/raw replies, edits, idempotent retries, undo, client attribution, two independent owner profiles, wrong-owner rejection, cancellation and offline discovery. Malformed discovery JSON produces a fixed error without echoing token contents.
- `tests/desktop/verify-mcp-adapters.mjs` runs the Electron acceptance workflow against the real browser-backed host. Every tool has a success and failure case, with project/revision preservation after failures. It checks helper apply/undo, restore, cached transcription, picture delay, render outputs, asset insertion/credits, saved segments and cancellation. Its evidence is [mcp-adapters-runtime.json](mcp-adapters-runtime.json).

Run the runtime check after `vp run build:desktop`, with the web dev server at `127.0.0.1:4270`:

```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
vp exec --filter @sidecut/desktop electron ../../tests/desktop/verify-mcp-adapters.mjs
```

The runtime is Windows development Electron. Provider generation uses synthetic success/failure responses with real normalization and an explicit opt-in; it makes no paid request. Transcription uses cached words and downloads no model. Watch/wait retain SideCut's long-poll/final-result behavior. Managed exclusive render output names and browser-backed asset storage remain. MCP currently runs from the repository with its SDK dependencies. Native macOS/Linux installation and upstream audio/video golden comparisons are unverified.
