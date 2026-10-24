import { afterEach, expect, it } from "vite-plus/test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { HostProjectService } from "./project-service.ts";
import { NativeProjectStore } from "./project-store.ts";
import { ProjectAPI } from "./project-api.ts";
import { LocalHTTPService } from "./http-service.ts";
import inventory from "../../../../tests/fixtures/tandem/pinned-inventory.json";
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of cleanup.reverse().splice(0)) await close();
});
it("speaks MCP over stdio with 43 tools, shared edits, undo, failures and cancellation", async () => {
  const root = await mkdtemp(join(tmpdir(), "sidecut-mcp-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const host = new HostProjectService(new NativeProjectStore(join(root, "current.tandem")));
  await host.start();
  cleanup.push(() => host.close());
  const api = new ProjectAPI(host),
    server = new LocalHTTPService(api),
    endpoint = await server.start();
  cleanup.push(() => server.close());
  const path = join(root, "endpoint.json");
  await writeFile(path, JSON.stringify(endpoint));
  const client = new Client({ name: "SideCut acceptance", version: "1.0" }),
    transport = new StdioClientTransport({
      command: process.execPath,
      args: [resolve("scripts/sidecut-mcp.mjs"), "--endpoint-file", path],
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string",
          ),
        ),
        ELECTRON_RUN_AS_NODE: "1",
      },
      stderr: "pipe",
    });
  await client.connect(transport);
  cleanup.push(() => client.close());
  expect((await client.listTools()).tools.map((tool) => tool.name).sort()).toEqual(
    [...inventory.tools].sort(),
  );
  expect(client.getInstructions()).toContain("expectedRevision");
  const edit = await client.callTool({
    name: "apply",
    arguments: {
      commands: [{ updateProject: { patch: { name: "MCP project" } } }],
      expectedRevision: 0,
      idempotencyKey: "mcp-once",
    },
  });
  expect(edit.isError).not.toBe(true);
  expect(
    (
      await client.callTool({
        name: "apply",
        arguments: {
          commands: [{ updateProject: { patch: { name: "MCP project" } } }],
          expectedRevision: 0,
          idempotencyKey: "mcp-once",
        },
      })
    ).isError,
  ).not.toBe(true);
  expect(JSON.parse(host.snapshot().json)).toMatchObject({
    revision: 1,
    project: { name: "MCP project" },
  });
  expect(
    (await client.callTool({ name: "undo", arguments: { expectedRevision: 1 } })).isError,
  ).not.toBe(true);
  expect(JSON.parse(host.snapshot().json).project.name).toBe("Untitled sequence");
  expect((await client.callTool({ name: "check", arguments: {} })).isError).toBe(true);
  expect(
    (await client.callTool({ name: "status", arguments: { secret: "invalid" } })).isError,
  ).toBe(true);
  const controller = new AbortController();
  const waiting = client.callTool({ name: "watch", arguments: { timeout: 5 } }, undefined, {
    signal: controller.signal,
  });
  controller.abort();
  await expect(waiting).rejects.toThrow();
});
