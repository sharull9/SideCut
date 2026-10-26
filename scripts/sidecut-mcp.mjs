#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { discoverHost, hostCall } from "./host-client.mjs";
import { findProject, verifyProjectOwner } from "./cli-foundation.mjs";
import { definitions, prepareTool, toolResult, clientAuthor } from "./mcp-adapters.mjs";

const instructions =
  "SideCut edits running desktop projects. Read status/timeline before editing. Use expectedRevision on mutations, label edits, and use apply idempotencyKey for retries. Helpers preview unless apply:true. Resolve comments with removeMarker. Read effects capability flags. Provider downloads/paid generation require explicit opt-in. Do not retry other mutations after a lost reply. Tools return readable text by default; json:true returns raw data. project selects an existing running owner; closed-project/headless editing is unsupported. Read warnings and the documented Tandem adapter limits.";

async function main() {
  const options = new Map();
  for (let i = 2; i < process.argv.length; i += 2) {
    const key = process.argv[i];
    if (
      !["--endpoint-file", "--project", "--author"].includes(key) ||
      !process.argv[i + 1] ||
      options.has(key)
    )
      throw new Error("Expected --endpoint-file, --project, or --author followed by a value.");
    options.set(key, process.argv[i + 1]);
  }
  const server = new Server(
    { name: "sidecut", version: "0.1.0" },
    { capabilities: { tools: {} }, instructions },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: definitions.map(({ name, title, description, inputSchema, annotations }) => ({
      name,
      title,
      description,
      inputSchema,
      annotations,
    })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    try {
      const { tool, input, json, project } = prepareTool(
        request.params.name,
        request.params.arguments,
      );
      if (tool.name === "effects") {
        const result = JSON.parse(
          await readFile(new URL("./effects-catalog.json", import.meta.url), "utf8"),
        );
        if (input.type != null)
          result.effects = result.effects.filter(
            (effect) => effect.type.toLowerCase() === input.type.toLowerCase(),
          );
        if (!result.effects.length) throw new Error("Unknown effect type.");
        return toolResult(tool.operation, result, json);
      }
      const selected = tool.usesProject
        ? (project ??
          options.get("--project") ??
          process.env.SIDECUT_PROJECT ??
          process.env.TANDEM_PROJECT)
        : undefined;
      const owner = selected == null ? undefined : await findProject(selected);
      let host;
      // Reuse the configured profile if it owns the project; otherwise connect
      // to that project's existing owner. Never create another coordinator.
      try {
        host = await discoverHost(options.get("--endpoint-file"));
        if (owner)
          await verifyProjectOwner(owner, await hostCall(host, "status", {}, extra.signal));
      } catch (error) {
        if (!owner || extra.signal.aborted) throw error;
        host = await discoverHost(`${owner}.api.json`);
        await verifyProjectOwner(owner, await hostCall(host, "status", {}, extra.signal));
      }
      const author = options.get("--author") ?? clientAuthor(server.getClientVersion()?.name);
      return toolResult(
        tool.operation,
        await hostCall(host, tool.operation, input, extra.signal, author),
        json,
      );
    } catch (error) {
      return {
        isError: true,
        content: [{ type: "text", text: error.message ?? "Host request failed." }],
      };
    }
  });
  await server.connect(new StdioServerTransport());
  process.once("SIGINT", () => void server.close());
}
main().catch((error) => {
  process.stderr.write(`SideCut MCP could not start: ${error.message}\n`);
  process.exitCode = 1;
});
