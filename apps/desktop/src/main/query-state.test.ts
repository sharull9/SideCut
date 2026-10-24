import { describe, it, expect, afterEach } from "vite-plus/test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HostProjectService } from "./project-service.ts";
import { NativeProjectStore } from "./project-store.ts";
import { ProjectAPI } from "./project-api.ts";
import { decodeProjectFile, encodeProjectFile } from "@sidecut/contracts/project";

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of cleanup.reverse().splice(0)) await close();
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "sidecut-queries-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "current.tandem"),
    host = new HostProjectService(new NativeProjectStore(path));
  await host.start();
  cleanup.push(() => host.close());
  await host.replace(
    encodeProjectFile(
      decodeProjectFile({
        revision: 0,
        project: {
          id: "queries",
          name: "Queries",
          media: [{ id: "m", path: "missing.mov", kind: "video", hasAudio: true, role: "camera" }],
          videoTracks: [
            {
              id: "v",
              kind: "video",
              clips: [{ id: "c", duration: 2, content: { media: { mediaID: "m" } } }],
            },
          ],
        },
      }),
    ),
  );
  const file = () => JSON.parse(host.snapshot().json);
  const state = () => ({
    projectID: file().project.id,
    revision: file().revision,
    warnings: ["Fixture font is unavailable"],
    jobs: [{ id: "j", mediaID: "m", kind: "transcript", state: "running", progress: 0.4 }],
    exports: [{ id: "e", output: "movie.webm", preset: "webm", state: "done", progress: 1 }],
    media: {
      m: {
        exists: true,
        analysis: {
          transcript: { state: "running", progress: 0.4 },
          waveform: { state: "ready" },
          proxy: { state: "failed", message: "No decoder" },
        },
      },
    },
  });
  return { host, path, file, state };
}
describe("120.01 and 120.03 shared query state", () => {
  it("reports renderer jobs/exports/fonts, copied resources and analysis states at the shared revision", async () => {
    const { host, file, state } = await fixture();
    const api = new ProjectAPI(host, undefined, {
      ready: () => true,
      run: async () => state(),
      screenshot: async () => new Uint8Array(),
    });
    api.setOwnerPort(1234);
    const before = host.snapshot().json;
    expect(await api.handle("status", {})).toMatchObject({
      revision: 0,
      dirty: false,
      openIn: { owner: "app", pid: process.pid, port: 1234 },
      jobs: state().jobs,
      exports: state().exports,
      warnings: ["Fixture font is unavailable"],
      reviewPending: [],
    });
    expect(await api.handle("media", {})).toMatchObject({
      revision: 0,
      items: [{ id: "m", exists: true, clips: 1, analysis: state().media.m.analysis }],
    });
    expect(host.snapshot().json).toBe(before);
    expect(file().revision).toBe(0);
  });
  it("rejects malformed, stale, replaced and cancelled renderer snapshots", async () => {
    const { host, state } = await fixture();
    const api = (run: () => Promise<unknown>) =>
      new ProjectAPI(host, undefined, { run, screenshot: async () => new Uint8Array() });
    await expect(
      api(async () => ({ ...state(), revision: 4 })).handle("status", {}),
    ).rejects.toThrow(/stale/);
    await expect(
      api(async () => ({ ...state(), jobs: [{ state: "bogus" }] })).handle("media", {}),
    ).rejects.toThrow(/Invalid editor/);
    await expect(
      api(async () => {
        const old = state();
        await host.replace(host.snapshot().json);
        return old;
      }).handle("status", {}),
    ).rejects.toThrow(/stale/);
    const controller = new AbortController();
    controller.abort();
    await expect(
      api(async () => state()).handle("status", {}, controller.signal),
    ).rejects.toThrow();
  });
  it("preserves pending agent reviews across reads/restart and only UI acknowledgment clears them", async () => {
    const { host, path, file } = await fixture(),
      api = new ProjectAPI(host);
    const initial = host.snapshot().json;
    await api.handle("apply", {
      expectedRevision: 0,
      label: "Agent changes",
      commands: [{ updateClip: { clipID: "c", patch: { name: "Agent name" } } }],
    });
    await host.flush();
    const before = host.snapshot().json;
    expect(await api.handle("status", {})).toMatchObject({
      reviewPending: [
        {
          label: "Agent changes",
          author: "agent",
          clipIDs: ["c"],
          removals: 0,
          date: expect.any(String),
        },
      ],
    });
    expect(await api.handle("status", {})).toMatchObject({
      reviewPending: [{ label: "Agent changes" }],
    });
    expect(host.snapshot().json).toBe(before);
    await expect(api.handle("markReviewed", {})).rejects.toThrow();
    expect(() =>
      host.request(
        JSON.stringify({
          type: "markReviewed",
          projectID: "queries",
          generation: host.snapshot().generation,
          revision: 0,
        }),
      ),
    ).toThrow(/changed/);
    host.request(
      JSON.stringify({
        type: "markReviewed",
        projectID: "queries",
        generation: host.snapshot().generation,
        revision: file().revision,
      }),
    );
    expect(host.reviewPending()).toEqual([]);
    expect(host.snapshot().json).toBe(before);
    await host.close();
    const restarted = new HostProjectService(new NativeProjectStore(path));
    await restarted.start();
    cleanup.push(() => restarted.close());
    await expect(new ProjectAPI(restarted).handle("status", {})).resolves.toMatchObject({
      revision: 1,
      reviewPending: [],
    });
    await restarted.replace(initial);
    const restoredAPI = new ProjectAPI(restarted);
    await restoredAPI.handle("apply", {
      expectedRevision: 0,
      label: "After recovery",
      commands: [{ updateClip: { clipID: "c", patch: { name: "New branch edit" } } }],
    });
    expect(restarted.reviewPending()).toMatchObject([{ label: "After recovery" }]);
  });
  it("reports resource/cache limitations without a renderer and keeps words query read-only", async () => {
    const { host } = await fixture(),
      api = new ProjectAPI(host, undefined, {
        ready: () => false,
        run: async () => {
          throw new Error("must not call");
        },
        screenshot: async () => new Uint8Array(),
      });
    expect(await api.handle("status", {})).toMatchObject({
      jobs: [],
      warnings: [expect.stringContaining("No ready editor")],
    });
    expect(await api.handle("media", {})).toMatchObject({
      items: [{ exists: false, analysis: { transcript: { state: "none" } } }],
      warnings: [expect.stringContaining("No ready editor")],
    });
    const before = host.snapshot().json;
    await api.handle("timeline", { words: true });
    expect(host.snapshot().json).toBe(before);
  });
});
