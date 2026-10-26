import { afterEach, expect, it } from "vite-plus/test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
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
  const status = CallToolResultSchema.parse(
    await client.callTool({ name: "status", arguments: {} }),
  );
  expect(status).toMatchObject({
    isError: false,
    content: [{ type: "text", text: expect.stringContaining("Untitled sequence") }],
  });
  expect(status.content[0]).not.toMatchObject({ text: expect.stringMatching(/^\{/) });
  const raw = CallToolResultSchema.parse(
    await client.callTool({ name: "status", arguments: { json: true } }),
  );
  expect(raw.content[0]?.type === "text" && JSON.parse(raw.content[0].text)).toMatchObject({
    revision: 0,
  });
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
  const history = CallToolResultSchema.parse(
    await client.callTool({ name: "history", arguments: { json: true } }),
  );
  expect(history.content[0]?.type === "text" && history.content[0].text).toContain(
    "SideCut acceptance",
  );
  expect(
    (await client.callTool({ name: "undo", arguments: { expectedRevision: 1 } })).isError,
  ).not.toBe(true);
  expect(JSON.parse(host.snapshot().json).project.name).toBe("Untitled sequence");
  const secondPath = join(root, "other-profile", "other.tandem");
  const second = new HostProjectService(new NativeProjectStore(secondPath));
  await second.start();
  cleanup.push(() => second.close());
  const otherServer = new LocalHTTPService(new ProjectAPI(second));
  const otherEndpoint = await otherServer.start();
  cleanup.push(() => otherServer.close());
  await writeFile(`${secondPath}.api.json`, JSON.stringify(otherEndpoint));
  const crossProject = await client.callTool({
    name: "apply",
    arguments: {
      project: secondPath,
      expectedRevision: 0,
      commands: [{ updateProject: { patch: { name: "Other owner" } } }],
    },
  });
  expect(crossProject.isError, JSON.stringify(crossProject)).toBe(false);
  expect(JSON.parse(second.snapshot().json)).toMatchObject({
    revision: 1,
    project: { name: "Other owner" },
  });
  expect(JSON.parse(host.snapshot().json).project.name).toBe("Untitled sequence");
  // A stale discovery file must not send an edit to the configured owner.
  await writeFile(`${secondPath}.api.json`, JSON.stringify(endpoint));
  const wrongOwner = await client.callTool({
    name: "apply",
    arguments: {
      project: secondPath,
      commands: [{ updateProject: { patch: { name: "Wrong project" } } }],
    },
  });
  expect(wrongOwner).toMatchObject({
    isError: true,
    content: [{ type: "text", text: expect.stringContaining("different project") }],
  });
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

it("initializes and lists contracts offline, keeping malformed discovery credentials out of replies", async () => {
  const root = await mkdtemp(join(tmpdir(), "sidecut-mcp-offline-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "endpoint.json");
  const secret = "a".repeat(64);
  await writeFile(path, `{"token":"${secret}",invalid`);
  const client = new Client({ name: "Offline acceptance", version: "1" });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [resolve("scripts/sidecut-mcp.mjs"), "--endpoint-file", path],
      env: { ELECTRON_RUN_AS_NODE: "1" },
      stderr: "pipe",
    }),
  );
  cleanup.push(() => client.close());
  expect((await client.listTools()).tools).toHaveLength(43);
  expect(await client.callTool({ name: "status", arguments: {} })).toMatchObject({
    isError: true,
    content: [{ type: "text", text: "Invalid discovery file." }],
  });
  const effects = await client.callTool({ name: "effects", arguments: { json: true } });
  expect(effects.isError).toBe(false);
  expect(JSON.stringify(effects)).not.toContain(secret);
  expect(await client.callTool({ name: "effects", arguments: { type: "missing" } })).toMatchObject({
    isError: true,
    content: [{ type: "text", text: "Unknown effect type." }],
  });
  expect(await client.callTool({ name: "status", arguments: { json: "true" } })).toMatchObject({
    isError: true,
    content: [{ type: "text", text: expect.stringContaining("Invalid status arguments") }],
  });
});
