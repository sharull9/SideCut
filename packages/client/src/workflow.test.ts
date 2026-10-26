import { afterEach, expect, it } from "vite-plus/test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostProjectService } from "../../../apps/desktop/src/main/project-service";
import { NativeProjectStore } from "../../../apps/desktop/src/main/project-store";
import { ProjectAPI } from "../../../apps/desktop/src/main/project-api";
import { LocalHTTPService } from "../../../apps/desktop/src/main/http-service";
import { SideCutClient, cmd } from "./index";
import { openProjectClient } from "./node";
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of cleanup.reverse().splice(0)) await close();
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "sidecut-sdk-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "current.tandem"),
    host = new HostProjectService(new NativeProjectStore(path));
  await host.start();
  cleanup.push(() => host.close());
  const server = new LocalHTTPService(new ProjectAPI(host)),
    endpoint = await server.start();
  cleanup.push(() => server.close());
  await writeFile(`${path}.api.json`, JSON.stringify(endpoint));
  return { root, path, host, endpoint };
}

it("reads project helpers and dry-runs guarded batches before one atomic edit", async () => {
  const { host, endpoint } = await fixture(),
    requests: { operation: string; body: unknown }[] = [];
  const client = new SideCutClient(
    endpoint,
    async (input, init) => {
      requests.push({
        operation: String(input).split("/").at(-1)!,
        body: JSON.parse(String(init?.body)),
      });
      return fetch(input, init);
    },
    "محرر SDK",
  );
  expect(await client.edit("Empty", [])).toEqual({ label: "Empty", skipped: "no commands" });
  expect(requests).toHaveLength(0);
  await expect(
    client.edit("No read", [cmd.updateProject({ patch: { name: "Unsafe" } })]),
  ).rejects.toThrow("Read status or project");
  const project = await client.project();
  expect(project.revision).toBe(0);
  expect(client.revision).toBe(0);
  const commands = [
    cmd.insertClip({
      trackID: project.track("Text").id,
      clip: { id: "caption", duration: 2, content: { text: { text: "Hello" } } },
    }),
  ];
  expect(await client.edit("Preview", commands, { dryRun: "only" })).toMatchObject({
    dryRun: true,
    added: 1,
  });
  expect(client.revision).toBe(0);
  expect(JSON.parse(host.snapshot().json).revision).toBe(0);
  requests.length = 0;
  expect(
    await client.edit("Insert caption", commands, { idempotencyKey: "sdk-insert" }),
  ).toMatchObject({ revision: 1, commands: 1, added: 1, createdIDs: ["caption"] });
  expect(requests).toHaveLength(2);
  expect(requests.map((item) => item.body)).toMatchObject([
    { dryRun: true, expectedRevision: 0 },
    { expectedRevision: 0 },
  ]);
  expect(client.revision).toBe(1);
  expect((await client.project()).clip("caption").duration).toBe(2);
  expect((await client.history()).some((event) => event.author === "محرر SDK")).toBe(true);
  expect(await client.timelineText()).toContain("Hello");
  const before = host.snapshot().json;
  await expect(
    client.edit("Fail whole batch", [
      cmd.updateProject({ patch: { name: "Partial" } }),
      cmd.removeClips({ clipIDs: ["missing"] }),
    ]),
  ).rejects.toThrow();
  expect(host.snapshot().json).toBe(before);
  const competitor = new SideCutClient(endpoint);
  await competitor.apply([cmd.updateProject({ patch: { name: "Concurrent edit" } })], {
    expectedRevision: 1,
    idempotencyKey: "competing",
  });
  requests.length = 0;
  await expect(
    client.edit("Stale", [cmd.updateProject({ patch: { name: "Stale" } })]),
  ).rejects.toMatchObject({ code: "staleRevision", revision: 2 });
  expect(requests).toHaveLength(1);
  expect(client.revision).toBe(1);
  await client.undo(2);
  expect(client.revision).toBe(3);
});

it("retries an edit after a lost commit reply using the retained revision and key", async () => {
  const { host, endpoint } = await fixture();
  let lose = true;
  const client = new SideCutClient(endpoint, async (input, init) => {
    const response = await fetch(input, init);
    const body = JSON.parse(String(init?.body));
    if (String(input).endsWith("/apply") && body.dryRun !== true && lose) {
      lose = false;
      await response.text();
      throw new Error("Lost commit reply");
    }
    return response;
  });
  await client.status();
  const commands = [cmd.updateProject({ patch: { name: "Retained request" } })],
    options = { expectedRevision: 0, idempotencyKey: "retained" };
  await expect(client.edit("Retained", commands, options)).rejects.toThrow("Lost commit reply");
  expect(JSON.parse(host.snapshot().json).revision).toBe(1);
  expect(client.revision).toBe(0);
  expect(await client.edit("Retained", commands, options)).toMatchObject({ revision: 1 });
  expect(JSON.parse(host.snapshot().json).revision).toBe(1);
});

it("uses CLI discovery and rejects mismatched ownership and malformed discovery without token disclosure", async () => {
  const first = await fixture(),
    second = await fixture();
  const client = await openProjectClient(first.path, {
    endpointFile: `${first.path}.api.json`,
    author: "connected-sdk",
  });
  expect(client.revision).toBe(0);
  expect((await client.status()).path).toBe(first.path);
  await expect(
    openProjectClient(first.path, { endpointFile: `${second.path}.api.json` }),
  ).rejects.toThrow("different project");
  const token = "a".repeat(64),
    invalid = join(first.root, "invalid.json");
  await writeFile(invalid, `{"token":"${token}",broken`);
  await expect(openProjectClient(first.path, { endpointFile: invalid })).rejects.toThrow(
    /^Invalid discovery file\.$/,
  );
  expect(JSON.parse(first.host.snapshot().json).revision).toBe(0);
});

it("resets stateful regexes, validates responses, and forwards cancellation", async () => {
  const endpoint = { port: 1, token: "a".repeat(64) };
  const client = new SideCutClient(endpoint, async () =>
    Response.json({
      revision: 4,
      scope: "timeline",
      timelineTimes: true,
      words: [
        { text: "Comics,", start: 0, end: 1 },
        { text: "COMICS!", start: 1, end: 2 },
      ],
      missing: [],
    }),
  );
  const pattern = /comics/gi;
  pattern.lastIndex = 4;
  expect((await client.findWords(pattern, { context: 1 })).map((word) => word.index)).toEqual([
    0, 1,
  ]);
  expect(pattern.lastIndex).toBe(4);
  await expect(client.findWords(pattern, { context: -1 })).rejects.toThrow("nonnegative");
  await expect(
    new SideCutClient(endpoint, async () => Response.json({ revision: 1 })).status(),
  ).rejects.toThrow("Invalid status response");
  await expect(
    new SideCutClient(endpoint, async () => new Response("invalid")).status(),
  ).rejects.toMatchObject({
    code: "unavailable",
    message: "Host returned an invalid JSON response.",
  });
  const controller = new AbortController();
  let observed: AbortSignal | null | undefined;
  const cancel = new SideCutClient(endpoint, async (_input, init) => {
    observed = init?.signal;
    init?.signal?.throwIfAborted();
    return Response.json({});
  });
  controller.abort();
  await expect(cancel.call("watch", { timeout: 5 }, controller.signal)).rejects.toThrow();
  expect(observed).toBe(controller.signal);
});
it("keeps legacy explicit relink requests separate from folder author options", async () => {
  const { endpoint } = await fixture();
  const client = new SideCutClient(endpoint, fetch, "sdk-author");
  await expect(
    client.call("relink", { mediaID: "source", path: "source.wav" }),
  ).rejects.toMatchObject({
    code: "unavailable",
    message: "A ready editor is required for relink.",
  });
  await expect(
    client.call("relink", { mediaID: "source", path: "source.wav", author: "explicit" }),
  ).rejects.toMatchObject({ code: "badRequest" });
});
