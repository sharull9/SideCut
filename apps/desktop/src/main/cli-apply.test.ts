import { afterEach, expect, it } from "vite-plus/test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { parseArguments } from "../../../../scripts/cli-foundation.mjs";
import { prepareApplyCommand, applyText } from "../../../../scripts/cli-apply-command.mjs";
import contract from "../../../../tests/fixtures/tandem/cli-apply.json";
import { HostProjectService } from "./project-service.ts";
import { NativeProjectStore } from "./project-store.ts";
import { ProjectAPI } from "./project-api.ts";
import { LocalHTTPService } from "./http-service.ts";

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of cleanup.reverse().splice(0)) await close();
});

it("matches pinned apply text and bounds large created-ID lists", () => {
  for (const example of contract.examples) expect(applyText(example.result)).toBe(example.text);
  const result = {
    ...contract.examples[1]!.result,
    createdIDs: Array.from({ length: 14 }, (_, i) => `id_${i}`),
  };
  expect(applyText(result)).toContain("id_11, and 2 more (--json lists them all)");
  expect(applyText(result)).not.toContain("id_12");
});

it("normalizes native sources, preserves aliases and rejects ambiguous apply requests", async () => {
  const command = { updateProject: { patch: { name: "Inline" } } };
  const prepared = await prepareApplyCommand(
    parseArguments(["project", "apply", JSON.stringify(command), "--key", "job"]),
  );
  expect(prepared?.words).toEqual(["project", "apply"]);
  expect(prepared?.flags.get("idempotency-key")).toBe("job");
  expect(JSON.parse(String(prepared?.flags.get("request")))).toEqual({ commands: [command] });
  expect(prepared?.prepare({})).not.toHaveProperty("dryRun");
  for (const args of [
    ["apply"],
    ["apply", "one", "two"],
    ["apply", "{}", "--request", "{}"],
    ["apply", "--input", "one", "--commands", "[]"],
    ["apply", "{}", "--unknown", "value"],
    ["apply", "{}", "--key", "a", "--idempotency-key", "b"],
    ["apply", "--request", "null"],
  ])
    await expect(prepareApplyCommand(parseArguments(args))).rejects.toThrow();
});

it("applies file, inline and stdin batches atomically with dry runs, overrides and shared undo", async () => {
  const root = await mkdtemp(join(tmpdir(), "sidecut-cli-apply-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const host = new HostProjectService(new NativeProjectStore(join(root, "current.tandem")));
  await host.start();
  cleanup.push(() => host.close());
  const api = new ProjectAPI(host),
    server = new LocalHTTPService(api),
    endpoint = await server.start();
  cleanup.push(() => server.close());
  const discovery = join(root, "endpoint.json");
  await writeFile(discovery, JSON.stringify(endpoint));
  const cli = (args: string[], stdin = "") =>
    new Promise<{ code: number | null; out: string; err: string }>((done, reject) => {
      const child = spawn(
        process.execPath,
        [resolve("scripts/sidecut-cli.mjs"), ...args, "--endpoint-file", discovery],
        {
          cwd: root,
          env: {
            ...process.env,
            ELECTRON_RUN_AS_NODE: "1",
            SIDECUT_PROJECT: "",
            TANDEM_PROJECT: "",
            SIDECUT_AUTHOR: "",
            TANDEM_AUTHOR: "",
          },
          windowsHide: true,
        },
      );
      let out = "",
        err = "";
      child.stdout.on("data", (v) => (out += v));
      child.stderr.on("data", (v) => (err += v));
      child.on("error", reject);
      child.on("close", (code) => done({ code, out, err }));
      child.stdin.end(stdin);
    });
  const before = host.snapshot().json,
    initial = JSON.parse(before),
    track = initial.project.videoTracks[0].id;
  const commands = [
    {
      insertClip: {
        trackID: track,
        clip: {
          id: "cli-clip",
          duration: 3,
          content: { solid: { color: { r: 1, g: 0, b: 0, a: 1 } } },
        },
      },
    },
    { updateProject: { patch: { name: "CLI applied" } } },
  ];
  const file = join(root, "batch with spaces.json");
  await writeFile(
    file,
    JSON.stringify({
      commands,
      label: "File label",
      author: "file",
      expectedRevision: 999,
      idempotencyKey: "file-key",
      dryRun: false,
    }),
  );
  const preview = await cli([
    "apply",
    file,
    "--dry-run",
    "--expect",
    "0",
    "--label",
    "Preview",
    "--author",
    "tester",
    "--key",
    "preview",
  ]);
  expect(preview.code, preview.err).toBe(0);
  expect(preview.out).toContain('Dry run of "Preview" at revision 0');
  expect(host.snapshot().json).toBe(before);
  const applied = await cli(
    [
      "project",
      "apply",
      "-",
      "--expect",
      "0",
      "--key",
      "once",
      "--label",
      "CLI batch",
      "--author",
      "tester",
      "--json",
    ],
    JSON.stringify(commands),
  );
  expect(applied.code, applied.err).toBe(0);
  expect(JSON.parse(applied.out)).toMatchObject({
    revision: 1,
    label: "CLI batch",
    author: "tester",
    added: ["cli-clip"],
    dryRun: false,
  });
  const after = host.snapshot().json;
  const repeated = await cli(["apply", JSON.stringify(commands), "--expect", "0", "--key", "once"]);
  expect(repeated.code, repeated.err).toBe(0);
  expect(repeated.out).toContain("same idempotency key");
  expect(host.snapshot().json).toBe(after);
  const single = JSON.stringify({ updateProject: { patch: { name: "Inline" } } });
  expect((await cli(["apply", single, "--expect", "0"])).code).toBe(4);
  expect(host.snapshot().json).toBe(after);
  for (const args of [
    ["apply", "--request", "null"],
    ["apply", "--request", "{"],
    ["apply", JSON.stringify([commands[1], { removeClip: { clipID: "absent" } }])],
    ["apply", JSON.stringify({ commands: [{ updateProject: {}, removeClip: {} }] })],
  ]) {
    const failure = await cli(args);
    expect(failure.code).toBe(2);
    expect(failure.err).toMatch(/^Error:/);
    expect(host.snapshot().json).toBe(after);
  }
  expect((await cli(["undo"])).code).toBe(0);
  expect(JSON.parse(host.snapshot().json).project).toEqual(initial.project);
  const inline = await cli(["apply", single, "--author", "inline-cli"]);
  expect(inline.code, inline.err).toBe(0);
  expect(inline.out).toContain("by inline-cli as revision 3");
  for (const source of [
    ["--input", file],
    ["--request", JSON.stringify({ commands })],
    ["--commands", JSON.stringify(commands)],
  ]) {
    const check = await cli([
      "apply",
      ...source,
      "--dry-run",
      "--expect",
      "3",
      "--label",
      "Extension",
    ]);
    expect(check.code, check.err).toBe(0);
    expect(check.out).toContain('Dry run of "Extension"');
  }
}, 20000);
