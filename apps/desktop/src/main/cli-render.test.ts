import { afterEach, expect, it } from "vite-plus/test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { parseArguments } from "../../../../scripts/cli-foundation.mjs";
import { prepareRenderCommand, renderText } from "../../../../scripts/cli-render-commands.mjs";
import contract from "../../../../tests/fixtures/tandem/cli-render.json";
import { HostProjectService } from "./project-service.ts";
import { NativeProjectStore } from "./project-store.ts";
import { ProjectAPI } from "./project-api.ts";
import { LocalHTTPService } from "./http-service.ts";

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of cleanup.reverse().splice(0)) await close();
});
it("matches pinned readable images, exports, loudness metadata, curves and gain checks", () => {
  for (const example of contract.examples)
    expect(renderText(example.operation, example.result)).toBe(example.text);
});
it("maps positional render inputs, native options and default names", () => {
  const frames = prepareRenderCommand(parseArguments(["project", "frames", "1:00", "0.5", "0.5"]));
  expect(frames?.flags.get("times")).toBe("[60,0.5,0.5]");
  expect(frames?.prepare({ times: [60, 0.5, 0.5] }).output).toBe("frames-00.00.500-01.00.000.png");
  expect(() => frames?.prepare({ times: Array(1001).fill(0) })).toThrow("at most 1000");
  const interval = prepareRenderCommand(
    parseArguments(["frames", "--every", "0.5", "--from", "1"]),
  );
  expect(interval?.prepare({ every: "0.5", from: "1" }).output).toBe(
    "frames-every-0.5s-00.01.000-end.png",
  );
  expect(prepareRenderCommand(parseArguments(["screenshot"]))?.prepare({}).output).toBe(
    "sidecut-window.png",
  );
  const clip = prepareRenderCommand(
    parseArguments(["clip", "1", "2", "--audio-only", "--tracks", "Voice, Music"]),
  );
  expect(clip?.flags.get("start")).toBe("1");
  expect(clip?.flags.get("audio-only")).toBe(true);
  expect(clip?.prepare({ start: "1", end: "2", tracks: ["Voice, Music"] })).toEqual({
    start: 1,
    end: 2,
    tracks: ["Voice", "Music"],
  });
  expect(prepareRenderCommand(parseArguments(["loudness", "voice"]))?.flags.get("media-id")).toBe(
    "voice",
  );
  for (const args of [
    ["frames"],
    ["frames", "bad"],
    ["frames", "1", "--times", "[]"],
    ["screenshot", "extra"],
    ["clip", "1"],
    ["clip", "1", "2", "--start", "0"],
    ["export", "extra"],
    ["export", "--tracks", "Voice"],
    ["loudness", "a", "b"],
    ["loudness", "a", "--media-id", "b"],
  ])
    expect(() => prepareRenderCommand(parseArguments(args))).toThrow();
});
it("bounds readable curves and peak runs without truncating JSON data", () => {
  const points = Array.from({ length: 2001 }, (_, i) => ({
    time: i / 10,
    momentaryLUFS: null,
    shortTermLUFS: null,
    peakDBFS: null,
  }));
  const result = {
    curve: { start: 0, end: 200, step: 0.1, integratedLUFS: null, truePeakDBTP: null, points },
  };
  expect(renderText("loudness", result)).toContain("Short-term: " + "·".repeat(200));
  expect(renderText("loudness", result)).toContain("2001 rows: --json gives every one");
  expect(points).toHaveLength(2001);
  const peaks = {
    threshold: 0,
    windows: 201,
    stretches: Array.from({ length: 201 }, () => ({ start: 0, end: 1, peakDBFS: 1, windows: 1 })),
  };
  expect(renderText("loudness", { ...result, peaks })).toContain(
    "And 1 more; --json lists them all.",
  );
});
it("rejects unavailable rendering and invalid command forms without mutating the owner", async () => {
  const root = await mkdtemp(join(tmpdir(), "sidecut-cli-render-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const host = new HostProjectService(new NativeProjectStore(join(root, "current.tandem")));
  await host.start();
  cleanup.push(() => host.close());
  const server = new LocalHTTPService(new ProjectAPI(host)),
    endpoint = await server.start();
  cleanup.push(() => server.close());
  const discovery = join(root, "endpoint.json");
  await writeFile(discovery, JSON.stringify(endpoint));
  const before = host.snapshot().json;
  const run = (args: string[]) =>
    new Promise<{ code: number | null; err: string }>((done, reject) => {
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
          },
          windowsHide: true,
        },
      );
      let err = "";
      child.stdout.resume();
      child.stderr.on("data", (v) => (err += v));
      child.on("error", reject);
      child.on("close", (code) => done({ code, err }));
    });
  for (const args of [
    ["frames", "0"],
    ["screenshot"],
    ["clip", "0", "1"],
    ["export"],
    ["loudness"],
  ]) {
    const result = await run(args);
    expect(result.code, result.err).toBe(3);
    expect(result.err).toMatch(/^Error:/);
    expect(host.snapshot().json).toBe(before);
  }
  for (const args of [
    ["clip", "1", "0"],
    ["frames", "--every", "-1"],
    ["screenshot", "extra"],
    ["export", "--unknown", "value"],
    ["loudness", "a", "b"],
  ]) {
    expect((await run(args)).code).toBe(2);
    expect(host.snapshot().json).toBe(before);
  }
}, 20000);
