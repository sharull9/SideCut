import { afterEach, expect, it } from "vite-plus/test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { parseArguments } from "../../../../scripts/cli-foundation.mjs";
import {
  prepareAnalysisCommand,
  analysisText,
} from "../../../../scripts/cli-analysis-commands.mjs";
import contract from "../../../../tests/fixtures/tandem/cli-analysis.json";
import { HostProjectService } from "./project-service.ts";
import { NativeProjectStore } from "./project-store.ts";
import { ProjectAPI } from "./project-api.ts";
import { LocalHTTPService } from "./http-service.ts";
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of cleanup.reverse().splice(0)) await close();
});
it("matches pinned analysis, comments and history helper text", () => {
  for (const e of contract.examples) expect(analysisText(e.operation, e.result)).toBe(e.text);
});
it("maps native sync/wait/transcription/diff selectors and preview defaults", () => {
  expect(
    prepareAnalysisCommand(parseArguments(["sync", "80ms", "--default"]))?.flags.get("delay"),
  ).toBe("0.08");
  expect(prepareAnalysisCommand(parseArguments(["sync", "-0.08"]))?.flags.get("delay")).toBe(
    "-0.08",
  );
  expect(
    prepareAnalysisCommand(parseArguments(["sync", "mic.wav", "--no-place"]))?.flags.get("place"),
  ).toBe("false");
  expect(prepareAnalysisCommand(parseArguments(["wait", "transcript"]))?.flags.get("what")).toBe(
    "transcript",
  );
  expect(
    prepareAnalysisCommand(parseArguments(["transcribe", "camera"]))?.prepare({
      media: ["camera"],
    }),
  ).toMatchObject({ wait: false });
  expect(prepareAnalysisCommand(parseArguments(["diff", "r2"]))?.flags.get("since")).toBe("r2");
  expect(
    prepareAnalysisCommand(parseArguments(["restore", "--from", "2"]))?.prepare({ from: "2" }),
  ).toMatchObject({ apply: false });
  expect(
    prepareAnalysisCommand(parseArguments(["clips", "--media", "camera"]))?.flags.get("media"),
  ).toBe("camera");
  for (const args of [
    ["comments", "--all"],
    ["comments", "resolve"],
    ["comments", "resolve", "c", "--all"],
    ["sync", "oops"],
    ["wait", "unknown"],
    ["transcribe"],
    ["transcribe", "a", "--wait", "--no-wait"],
    ["diff"],
    ["diff", "1", "--since", "2"],
    ["restore"],
    ["clips", "extra"],
  ])
    expect(() => prepareAnalysisCommand(parseArguments(args))).toThrow();
});
it("resolves comments, changes picture delay and previews/restores clips through the shared host", async () => {
  const root = await mkdtemp(join(tmpdir(), "sidecut-cli-analysis-"));
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
  const run = (args: string[]) =>
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
            SIDECUT_AUTHOR: "cli-analysis",
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
    });
  const initial = JSON.parse(host.snapshot().json),
    track = initial.project.videoTracks[0].id;
  await api.handle("apply", {
    commands: [
      {
        addMedia: {
          item: {
            id: "camera",
            path: "camera.mp4",
            kind: "video",
            role: "camera",
            hasVideo: true,
            hasAudio: true,
            duration: 2,
          },
        },
      },
      {
        insertClip: {
          trackID: track,
          clip: { id: "c", duration: 1, content: { solid: { color: { r: 1, g: 0, b: 0, a: 1 } } } },
        },
      },
      { addMarker: { marker: { id: "comment", kind: "comment", name: "Review", time: 0.5 } } },
    ],
  });
  const seeded = host.snapshot().json;
  expect((await run(["comments"])).out).toContain('comment  00:00.500  "Review"');
  const resolved = await run(["comments", "resolve", "comment", "--label", "Resolved", "--json"]);
  expect(resolved.code, resolved.err).toBe(0);
  expect(JSON.parse(resolved.out)).toMatchObject({
    revision: 2,
    author: "cli-analysis",
    label: "Resolved",
  });
  await api.handle("undo", {});
  expect(JSON.parse(host.snapshot().json).project).toEqual(JSON.parse(seeded).project);
  const bad = await run(["comments", "resolve", "unknown"]);
  expect(bad.code).toBe(2);
  const sync = await run(["sync", "80ms", "--media", "camera", "--label", "Delay", "--json"]);
  expect(sync.code, sync.err).toBe(0);
  expect(JSON.parse(sync.out).applied.author).toBe("cli-analysis");
  expect(JSON.parse(host.snapshot().json).project.media[0].pictureDelay).toBe(0.08);
  await api.handle("undo", {});
  await api.handle("apply", { commands: [{ updateClip: { clipID: "c", patch: { start: 0.2 } } }] });
  const moved = host.snapshot().json;
  const diff = await run(["diff", "1", "--json"]);
  expect(diff.code, diff.err).toBe(0);
  expect(JSON.parse(diff.out).changes).toEqual([expect.objectContaining({ id: "c", shift: 0.2 })]);
  const preview = await run(["restore", "--from", "1", "--clips", "c"]);
  expect(preview.code, preview.err).toBe(0);
  expect(preview.out).toContain("dry run");
  expect(host.snapshot().json).toBe(moved);
  const applied = await run([
    "restore",
    "--from",
    "1",
    "--clips",
    "c",
    "--apply",
    "--label",
    "Restore",
    "--json",
  ]);
  expect(applied.code, applied.err).toBe(0);
  expect(JSON.parse(applied.out).applied.author).toBe("cli-analysis");
  expect(JSON.parse(host.snapshot().json).project.videoTracks[0].clips[0].start).toBe(0);
  await api.handle("undo", {});
  expect(JSON.parse(host.snapshot().json).project).toEqual(JSON.parse(moved).project);
  expect((await run(["clips", "--ids"])).out).toBe("c\n");
  expect((await run(["wait", "export"])).out).toBe("No exports running.\n");
  for (const args of [
    ["sync", "2"],
    ["diff", "999"],
    ["restore", "--from", "999", "--clips", "c", "--apply"],
    ["clips", "--track", "missing"],
    ["transcribe", "camera"],
  ])
    expect((await run(args)).code).not.toBe(0);
}, 20000);
