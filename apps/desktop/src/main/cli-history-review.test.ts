import { afterEach, expect, it } from "vite-plus/test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { decodeProjectFile } from "@sidecut/contracts/project";
import { reviewQuery } from "@sidecut/core/service-review";
import { parseArguments } from "../../../../scripts/cli-foundation.mjs";
import { prepareQueryCommand, queryText } from "../../../../scripts/cli-query-commands.mjs";
import contract from "../../../../tests/fixtures/tandem/cli-history-review.json";
import { HostProjectService } from "./project-service.ts";
import { NativeProjectStore } from "./project-store.ts";
import { ProjectAPI } from "./project-api.ts";
import { LocalHTTPService } from "./http-service.ts";

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of cleanup.reverse().splice(0)) await close();
});
function cli(root: string, endpoint: string, args: string[]) {
  return new Promise<{ code: number | null; out: string; err: string }>((done, reject) => {
    const child = spawn(
      process.execPath,
      [resolve("scripts/sidecut-cli.mjs"), ...args, "--endpoint-file", endpoint],
      {
        cwd: root,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", SIDECUT_PROJECT: "", TANDEM_PROJECT: "" },
        windowsHide: true,
      },
    );
    let out = "",
      err = "";
    child.stdout.on("data", (v) => (out += v));
    child.stderr.on("data", (v) => (err += v));
    child.on("error", reject);
    child.on("close", (code) => done({ code, out, err }));
  });
}
it("matches pinned history/review results and native frame defaults", () => {
  for (const example of contract.examples)
    expect(queryText(example.operation, example.result)).toBe(example.text);
  const frame = prepareQueryCommand(
    parseArguments(["project", "frame", "1:23.5s", "--width", "320", "--height", "180"]),
  );
  expect(frame?.flags.get("max-width")).toBe("320");
  expect(frame?.flags.get("max-height")).toBe("180");
  expect(frame?.prepare({ time: "1:23.5s" })).toEqual({
    time: 83.5,
    output: "frame-01.23.500.png",
  });
  for (const args of [
    ["undo", "extra"],
    ["redo", "--apply"],
    ["history", "--count", "2"],
    ["validate", "--refresh"],
    ["frame"],
    ["frame", "nope"],
    ["frame", "1:60"],
    ["frame", "-1"],
    ["frame", "0", "--time", "1"],
    ["frame", "0", "--width", "20", "--max-width", "30"],
  ])
    expect(() => prepareQueryCommand(parseArguments(args))).toThrow();
});
it("formats history openings, scan runs and fallback events", () => {
  const history = queryText("history", {
    revision: 3,
    undo: [],
    edits: [
      {
        revision: 3,
        kind: "apply",
        label: "Found new media",
        author: "system",
        date: "2001-01-02T03:04:05",
      },
      {
        revision: 2,
        kind: "apply",
        label: "Found new media",
        author: "system",
        date: "2001-01-02T03:03:05",
      },
      { revision: 1, kind: "opened", date: "2001-01-02T03:02:05" },
    ],
  });
  expect(history).toContain(
    "r2-r3  2001-01-02 03:03-2001-01-02 03:04  Found new media x2  (system)",
  );
  expect(history).toContain("the history starts here (edits before it weren't recorded");
  expect(
    queryText("history", {
      revision: 1,
      undo: [],
      events: [
        { date: "2001-01-02T03:04:05", revision: 1, kind: "apply", label: "Edit", author: "cli" },
      ],
    }),
  ).toContain("03:04:05  r1  apply  Edit  (cli)");
});
it("runs undo/redo counts, stale guards, history limits and validate through the shared host", async () => {
  const root = await mkdtemp(join(tmpdir(), "sidecut-cli-history-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const host = new HostProjectService(new NativeProjectStore(join(root, "current.tandem")));
  await host.start();
  cleanup.push(() => host.close());
  const api = new ProjectAPI(host),
    server = new LocalHTTPService(api),
    endpoint = await server.start(),
    discovery = join(root, "endpoint.json");
  cleanup.push(() => server.close());
  await writeFile(discovery, JSON.stringify(endpoint));
  const run = (...args: string[]) => cli(root, discovery, args);
  const initial = host.snapshot().json;
  for (const operation of ["undo", "redo"]) {
    const empty = await run(operation);
    expect(empty.code).toBe(2);
    expect(empty.err).toContain(`Nothing to ${operation}`);
  }
  for (const label of ["First", "Second"])
    await api.handle("apply", {
      label,
      author: "fixture",
      commands: [{ updateProject: { patch: { name: label } } }],
    });
  const before = host.snapshot().json;
  const history = await run("history", "--limit", "1", "--json");
  expect(history.code, history.err).toBe(0);
  expect(JSON.parse(history.out)).toMatchObject({
    revision: 2,
    undo: [{ label: "Second" }],
    edits: [{ label: "Second" }],
  });
  expect((await run("history")).out).toContain("Undo, newest first:");
  expect((await run("validate")).out).toContain("valid. No problems found.");
  for (const args of [
    ["undo", "--expect", "0"],
    ["redo", "--expect", "0"],
    ["undo", "--count", "0"],
    ["redo", "--count", "501"],
    ["history", "--limit", "0"],
  ])
    expect((await run(...args)).code).not.toBe(0);
  expect(host.snapshot().json).toBe(before);
  const undone = await run("project", "undo", "--count", "2", "--expect", "2");
  expect(undone.code, undone.err).toBe(0);
  expect(undone.out).toContain(
    'Undid 2 edits: "Second" (by fixture), "First" (by fixture). Now at revision 4.',
  );
  expect(JSON.parse(host.snapshot().json).project).toEqual(JSON.parse(initial).project);
  const redone = await run("redo", "--count", "5", "--expect", "4", "--json");
  expect(redone.code, redone.err).toBe(0);
  expect(JSON.parse(redone.out)).toMatchObject({
    revision: 6,
    count: 2,
    labels: ["First", "Second"],
  });
  expect(JSON.parse(host.snapshot().json).project).toEqual(JSON.parse(before).project);
  expect((await run("undo")).out).toContain('Undid "Second"');
  expect((await run("redo")).out).toContain('Redid "Second"');
  const validation = await run("validate", "--json");
  expect(validation.code).toBe(0);
  expect(JSON.parse(validation.out).ok).toBe(true);
  expect((await run("frame", "0")).code).toBe(3);
  await api.handle("apply", {
    commands: [
      {
        insertClip: {
          trackID: JSON.parse(initial).project.videoTracks[0].id,
          clip: {
            id: "warning-clip",
            duration: 1,
            linkGroup: "solo",
            content: { solid: { color: { r: 1, g: 0, b: 0, a: 1 } } },
          },
        },
      },
    ],
  });
  const warning = await run("validate", "--json");
  expect(warning.code).toBe(0);
  expect(JSON.parse(warning.out)).toMatchObject({
    ok: true,
    issues: [expect.objectContaining({ severity: "warning" })],
  });
}, 20000);
it("returns exit 1 for invalid validation in text and JSON without mutating the fixture", async () => {
  const root = await mkdtemp(join(tmpdir(), "sidecut-cli-validation-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  // The authoritative host refuses invalid projects; exercise real validation at the CLI transport boundary.
  const file = decodeProjectFile({
    revision: 7,
    project: {
      id: "invalid",
      videoTracks: [
        {
          id: "v",
          kind: "video",
          clips: [{ id: "c", duration: 1, content: { media: { mediaID: "absent" } } }],
        },
      ],
    },
  });
  const before = JSON.stringify(file);
  const server = createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify(
        request.url === "/v1/schema"
          ? { operations: { validate: {} } }
          : reviewQuery(file, "validate", {}),
      ),
    );
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  cleanup.push(
    () =>
      new Promise<void>((done, reject) =>
        server.close((error) => (error ? reject(error) : done())),
      ),
  );
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing server address");
  const discovery = join(root, "endpoint.json");
  await writeFile(discovery, JSON.stringify({ port: address.port, token: "a".repeat(64) }));
  const text = await cli(root, discovery, ["validate"]),
    json = await cli(root, discovery, ["validate", "--json"]);
  expect(text.code).toBe(1);
  expect(text.out).toContain("uses missing media absent");
  expect(json.code).toBe(1);
  expect(JSON.parse(json.out)).toMatchObject({ ok: false, revision: 7 });
  expect(JSON.stringify(file)).toBe(before);
});
