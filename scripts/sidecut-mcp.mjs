#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { discoverHost, hostCall } from "./host-client.mjs";

const project = [
  "status",
  "timeline",
  "media",
  "transcript",
  "transcribe",
  "search",
  "pauses",
  "tighten",
  "join",
  "captions",
  "short",
  "cards",
  "apply",
  "undo",
  "redo",
  "history",
  "diff",
  "restore",
  "clips",
  "validate",
  "check",
  "sync",
  "comments",
  "frame",
  "frames",
  "screenshot",
  "clip",
  "export",
  "archive",
  "relink",
  "loudness",
  "watch",
  "wait",
  "effects",
];
const tools = Object.fromEntries([
  ...project.map((name) => [name, name]),
  ...["search", "use", "show", "credits", "generate", "providers"].map((name) => [
    `assets_${name}`,
    `assets-${name}`,
  ]),
  ["segments_list", "segments"],
  ["segments_save", "save-segment"],
  ["segments_insert", "insert-segment"],
]);
const readOnly = new Set([
  "status",
  "timeline",
  "transcript",
  "search",
  "pauses",
  "history",
  "diff",
  "clips",
  "validate",
  "comments",
  "frame",
  "frames",
  "screenshot",
  "loudness",
  "watch",
  "wait",
  "effects",
  "assets_show",
  "assets_credits",
  "assets_providers",
  "segments_list",
]);
const instructions =
  "SideCut edits the running desktop project. Read status/timeline before editing. Use expectedRevision on mutations, label edits, and use apply idempotencyKey for retries. Helpers preview unless apply:true. Resolve comments with removeMarker. Read effects capability flags. check supports quick:true only. Provider downloads/paid generation require explicit opt-in. Do not retry other mutations after a lost reply. Read warnings: this server exposes SideCut baseline adapters, with documented Tandem compatibility gaps.";
async function main() {
  const flag = process.argv.indexOf("--endpoint-file"),
    host = await discoverHost(flag < 0 ? undefined : process.argv[flag + 1]);
  const schema = await hostCall(host, "schema");
  const server = new Server(
    { name: "sidecut", version: "0.1.0" },
    { capabilities: { tools: {} }, instructions },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: Object.entries(tools).map(([name, operation]) => ({
      name,
      description: `${name.replaceAll("_", " ")} through the shared SideCut desktop host. Read returned warnings and capability limits.`,
      inputSchema: schema.jsonSchemas[operation],
      annotations: {
        readOnlyHint: readOnly.has(name),
        destructiveHint: !readOnly.has(name),
        idempotentHint: readOnly.has(name),
        openWorldHint: name.startsWith("assets_"),
      },
    })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const name = request.params.name;
    if (!Object.hasOwn(tools, name))
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: { code: "notFound", message: "Unknown tool." } }),
          },
        ],
      };
    try {
      const result = await hostCall(
        host,
        tools[name],
        request.params.arguments ?? {},
        extra.signal,
      );
      if (typeof result.png === "string") {
        const { png, ...metadata } = result;
        return {
          content: [
            { type: "text", text: JSON.stringify(metadata) },
            { type: "image", data: png, mimeType: "image/png" },
          ],
        };
      }
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: {
                code: error.code ?? "unavailable",
                message: error.message,
                revision: error.revision,
              },
            }),
          },
        ],
      };
    }
  });
  await server.connect(new StdioServerTransport());
  process.once("SIGINT", () => void server.close());
}
main().catch(() => {
  process.stderr.write(
    "SideCut MCP could not connect. Start the desktop and select its discovery file.\n",
  );
  process.exitCode = 1;
});
