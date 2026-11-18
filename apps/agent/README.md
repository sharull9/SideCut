# @sidecut/agent

The editing assistant built into the raE.E desktop app, written with [eve](https://eve.dev).

- **Tools** come from `scripts/mcp-adapters.mjs`, so the assistant, the MCP server and the CLI share one tool list. `agent/tools/sidecut.ts` turns each definition into an eve tool that calls the running desktop host.
- **Approvals** (`agent/lib/approval.ts`): reads run freely. Applied edits, undo/redo, export, studio changes and non-dry-run `sync`/`archive`/`relink` wait for the user in the Assistant panel. Paid generation and provider downloads always ask.
- **Model** (`agent/lib/model.ts`): the user configures the provider (Anthropic, OpenAI or OpenRouter), the model ID and that provider's key in the Assistant panel. Nothing is picked automatically. The desktop app passes `SIDECUT_AGENT_PROVIDER`, `SIDECUT_AGENT_MODEL` and only that provider's key.
- **Access** (`agent/channels/eve.ts`): the desktop app starts the server on 127.0.0.1 with a random per-launch bearer token and gives that token only to its own window.

The desktop app (`apps/desktop/src/main/assistant-agent.ts`) starts the built server the first time the Assistant tab opens. It stores session state under `<userData>/assistant`.

```sh
vp run build:agent        # build .output (also part of build:desktop / package:desktop)
vp run verify:assistant   # scripted model + stand-in host: tools, approvals, CORS, auth
```
