import { afterEach, expect, it } from "vite-plus/test";
import { mkdtemp, readFile, rm, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { SideCutClient } from "../../../../packages/client/src/index";
import { decodeProjectFile, encodeProjectFile } from "@sidecut/contracts/project";
import { HostProjectService, freshProject } from "./project-service.ts";
import { NativeProjectStore } from "./project-store.ts";
import { ProjectAPI } from "./project-api.ts";
import { LocalHTTPService } from "./http-service.ts";
import { supportReport } from "./support-report.ts";
import type { NativeRecording } from "@sidecut/contracts/native-recording";

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of cleanup.reverse().splice(0)) await close();
});
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "sidecut-support-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const host = new HostProjectService(new NativeProjectStore(join(root, "private-project.tandem")));
  await host.start();
  cleanup.push(() => host.close());
  const file = decodeProjectFile({
    revision: 0,
    project: {
      ...freshProject().project,
      id: "private-project-id",
      name: "Private customer title",
      metadata: {
        secret: "rtmps://example.test/live/stream-secret",
        email: "private@example.test",
      },
      settings: { frameRate: { numerator: 30, denominator: 1, secret: "private-settings" } },
      media: [
        {
          id: "private-media-id",
          path: "C:/Users/private-person/secret-media.mp4",
          frameRate: { numerator: 30, denominator: 1, secret: "private-frame-metadata" },
        },
      ],
    },
  });
  await host.replace(encodeProjectFile(file));
  return { root, host, api: new ProjectAPI(host) };
}

it("exports only approved technical fields through HTTP, SDK and the real CLI", async () => {
  const { root, host, api } = await setup();
  const before = host.snapshot().json;
  const server = new LocalHTTPService(api);
  const endpoint = await server.start();
  cleanup.push(() => server.close());
  const client = new SideCutClient(endpoint);
  const result = await client.diagnostics({ output: "support.json" });
  expect(result).toMatchObject({
    report: {
      format: "sidecut-support",
      version: 1,
      project: { mediaCount: 1, saveState: "saved" },
      services: { rendererReady: false, nativeMediaConfigured: false },
      recordings: { status: "unavailable" },
    },
  });
  const text = await readFile(join(root, "exports/support.json"), "utf8");
  expect(text.length).toBeLessThan(16384);
  for (const secret of [
    root,
    "private-",
    "Private customer",
    "stream-secret",
    "example.test",
    endpoint.token,
  ]) {
    expect(text).not.toContain(secret);
    expect(text).not.toContain(JSON.stringify(secret).slice(1, -1));
  }
  const discovery = join(root, "endpoint.json");
  await writeFile(discovery, JSON.stringify(endpoint));
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [resolve("scripts/sidecut-cli.mjs"), "diagnostics", "--endpoint-file", discovery, "--json"],
    { windowsHide: true },
  );
  expect(JSON.parse(stdout)).toMatchObject({ report: { format: "sidecut-support", version: 1 } });
  expect(host.snapshot().json).toBe(before);
}, 30000);

it("refuses output traversal, overwrites, unknown fields and pre-cancelled work", async () => {
  const { api, root, host } = await setup();
  const before = host.snapshot().json;
  await api.handle("diagnostics", { output: "support.json" });
  const saved = await readFile(join(root, "exports/support.json"), "utf8");
  await expect(api.handle("diagnostics", { output: "support.json" })).rejects.toThrow();
  await expect(api.handle("diagnostics", { output: "../outside.json" })).rejects.toThrow();
  await expect(api.handle("diagnostics", { includeSecrets: true })).rejects.toThrow();
  const controller = new AbortController();
  controller.abort();
  await expect(
    api.handle("diagnostics", { output: "cancelled.json" }, controller.signal),
  ).rejects.toThrow();
  expect(await readdir(join(root, "exports"))).toEqual(["support.json"]);
  expect(await readFile(join(root, "exports/support.json"), "utf8")).toBe(saved);
  expect(host.snapshot().json).toBe(before);
});

it("summarizes only the current project's recordings without returning journal content", async () => {
  const { host } = await setup();
  const recording = {
    id: "private-recording-id",
    projectID: "private-project-id",
    source: "camera",
    createdAt: "2026-11-01T00:00:00Z",
    status: "ready",
    encoder: "libx264",
    elapsedSeconds: 1,
    bytes: 1234,
    tracks: [],
    error: "private-recording-error",
  } satisfies NativeRecording;
  const report = await supportReport(
    host.snapshot(),
    false,
    true,
    {
      list: async () => [
        recording,
        { ...recording, projectID: "another-project", status: "error" },
      ],
    },
    new AbortController().signal,
  );
  expect(report.recordings).toEqual({
    status: "available",
    counts: { recording: 0, stopping: 0, ready: 1, interrupted: 0, error: 0 },
  });
  expect(JSON.stringify(report)).not.toMatch(/private|another-project|libx264/);
});

it("omits raw save and recording failures and honors cancellation after collection", async () => {
  const { host } = await setup();
  const snapshot = { ...host.snapshot(), error: "C:/private-person/token=save-secret" };
  const recorder = {
    list: async () => {
      throw new Error("rtmps://private.test/key device-secret");
    },
    stop: async () => {
      throw new Error("Must not stop capture");
    },
    streamStatus: () => {
      throw new Error("Must not inspect endpoints");
    },
  };
  const report = await supportReport(snapshot, false, true, recorder, new AbortController().signal);
  expect(report.project.saveError).toBe(true);
  expect(report.recordings.status).toBe("unavailable");
  expect(JSON.stringify(report)).not.toMatch(/private|secret|token=|rtmps:/);
  const controller = new AbortController();
  await expect(
    supportReport(
      snapshot,
      false,
      false,
      {
        ...recorder,
        list: async () => {
          controller.abort();
          return [];
        },
      },
      controller.signal,
    ),
  ).rejects.toThrow();
});
