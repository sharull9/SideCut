import { afterEach, describe, it, expect, vi } from "vite-plus/test";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ProjectAPI } from "./project-api.ts";
import { HostProjectService } from "./project-service.ts";
import { NativeProjectStore } from "./project-store.ts";
import { serviceOutput } from "./service-output.ts";
import fixture from "../../../../tests/fixtures/tandem/project-queries.json";
const clean: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const task of clean.reverse().splice(0)) await task();
});
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "sidecut-operations-"));
  clean.push(() => rm(root, { recursive: true, force: true }));
  const host = new HostProjectService(new NativeProjectStore(join(root, "current.tandem")));
  await host.start();
  clean.push(() => host.close());
  await host.replace(JSON.stringify(fixture.project));
  const run = vi.fn(async (operation: string): Promise<Record<string, unknown>> =>
    operation === "captions"
      ? {
          revision: 0,
          commands: [{ updateProject: { patch: { name: "Captioned" } } }],
          label: "Captions",
          warnings: [],
        }
      : { revision: 0, scope: "timeline", words: [], missing: ["med_query"] },
  );
  const api = new ProjectAPI(host, undefined, {
    run,
    screenshot: async () => new Uint8Array([1, 2]),
  });
  return { root, host, api, run };
}
describe("agent edits and renderer service boundary", () => {
  it("reports independent snapshot comparisons without inventing edit history and rejects missing baselines", async () => {
    const { api, root } = await setup();
    await writeFile(
      join(root, "snapshot.tandem"),
      JSON.stringify({
        ...fixture.project,
        project: { ...fixture.project.project, videoTracks: [] },
      }),
    );
    const result = await api.handle("diff", { since: "snapshot.tandem" });
    expect(result).toMatchObject({
      since: "the project file snapshot.tandem",
      changes: [{ kind: "added", id: "clip_query" }],
    });
    expect(result).not.toHaveProperty("edits");
    expect(result).not.toHaveProperty("sinceRevision");
    await expect(api.handle("diff", { since: "missing.tandem" })).rejects.toMatchObject({
      code: "notFound",
    });
    await writeFile(join(root, "bad.tandem"), "invalid");
    await expect(api.handle("diff", { since: "bad.tandem" })).rejects.toMatchObject({
      code: "badRequest",
    });
  });
  it("resolves revision aliases and durable reviewed baselines, with per-edit changes", async () => {
    const { api, host } = await setup();
    await api.handle("apply", {
      commands: [{ updateClip: { clipID: "clip_query", patch: { enabled: false } } }],
      label: "Disable",
    });
    await host.flush();
    const snapshot = host.snapshot();
    host.request(
      JSON.stringify({
        type: "markReviewed",
        projectID: fixture.project.project.id,
        generation: snapshot.generation,
        revision: 1,
      }),
    );
    await api.handle("apply", {
      commands: [{ updateClip: { clipID: "clip_query", patch: { name: "Changed" } } }],
      label: "Rename",
    });
    expect(await api.handle("diff", { since: " r1 " })).toMatchObject({
      sinceRevision: 1,
      edits: [{ revision: 2, label: "Rename", changes: [{ details: ['name none -> "Changed"'] }] }],
    });
    expect(await api.handle("diff", { since: "reviewed" })).toMatchObject({ sinceRevision: 1 });
    expect(await api.handle("restore", { from: "reviewed", clips: ["clip_query"] })).toMatchObject({
      revision: 2,
      items: [{ action: "changeBack" }],
    });
    const before = host.snapshot().json;
    await expect(
      api.handle("restore", { from: 0, clips: ["clip_query"], apply: true, expectedRevision: 1 }),
    ).rejects.toThrow(/Stale/);
    expect(host.snapshot().json).toBe(before);
    await expect(api.handle("diff", { since: "r100" })).rejects.toMatchObject({
      code: "badRequest",
    });
    await expect(api.handle("diff", { since: "r-1" })).rejects.toMatchObject({
      code: "badRequest",
    });
  });
  it("marks transcription once, reports worker wait results, and avoids edits for camera sources", async () => {
    const { api, host, run } = await setup();
    await api.handle("apply", {
      commands: [{ updateMedia: { mediaID: "med_query", patch: { hasAudio: true } } }],
    });
    run.mockResolvedValue({
      revision: 1,
      files: [{ mediaID: "med_query", state: "queued" }],
      waited: {
        what: "transcript",
        done: false,
        timedOut: true,
        elapsed: 0,
        finished: [],
        pending: [{ state: "queued" }],
      },
    });
    expect(
      await api.handle("transcribe", {
        media: ["clip_query", "med_query"],
        wait: true,
        timeout: 0,
      }),
    ).toMatchObject({ applied: { revision: 2 }, waited: { done: false, timedOut: true } });
    expect(await api.handle("transcribe", { media: ["med_query"] })).not.toHaveProperty("applied");
    await api.handle("undo", {});
    await api.handle("apply", {
      commands: [{ updateMedia: { mediaID: "med_query", patch: { role: "camera" } } }],
    });
    const before = host.snapshot().json;
    expect(await api.handle("transcribe", { media: ["med_query"] })).not.toHaveProperty("applied");
    expect(host.snapshot().json).toBe(before);
    const controller = new AbortController();
    controller.abort();
    await expect(
      api.handle("transcribe", { media: ["med_query"] }, controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
  it("uses shared revisions, rejects atomic failures and restores from a journal baseline", async () => {
    const { host, api } = await setup();
    const before = host.snapshot();
    await expect(
      api.handle("apply", {
        commands: [
          { updateProject: { patch: { name: "Partial" } } },
          { updateClip: { clipID: "missing", patch: { enabled: false } } },
        ],
      }),
    ).rejects.toThrow(/not found/);
    expect(host.snapshot().json).toBe(before.json);
    const dry = await api.handle("apply", {
      commands: [{ updateClip: { clipID: "clip_query", patch: { enabled: false } } }],
      dryRun: true,
    });
    expect(dry).toMatchObject({ revision: 0, dryRun: true, changed: ["clip_query"] });
    const edited = await api.handle("apply", {
      commands: [{ updateClip: { clipID: "clip_query", patch: { enabled: false } } }],
      expectedRevision: 0,
      author: "agent",
    });
    expect(edited).toMatchObject({ revision: 1 });
    await expect(api.handle("undo", { expectedRevision: 0 })).rejects.toThrow(/Stale/);
    expect(await api.handle("diff", { since: 0 })).toMatchObject({
      sinceRevision: 0,
      changes: [expect.objectContaining({ id: "clip_query", kind: "changed" })],
    });
    const restored = await api.handle("restore", {
      from: 0,
      clips: ["clip_query"],
      apply: true,
      expectedRevision: 1,
    });
    expect(restored).toMatchObject({ applied: { revision: 2 } });
    expect(await api.handle("history", { limit: 20 })).toMatchObject({
      revision: 2,
      undo: expect.arrayContaining([expect.objectContaining({ author: "agent" })]),
      edits: expect.arrayContaining([expect.objectContaining({ revision: 2 })]),
    });
    expect(await api.handle("undo", { expectedRevision: 2 })).toMatchObject({
      revision: 3,
      count: 1,
    });
    expect(await api.handle("redo", { expectedRevision: 3 })).toMatchObject({
      revision: 4,
      count: 1,
    });
  });
  it("keeps renderer queries read-only and rejects helper plans if a human edits during planning", async () => {
    const { api, host, run } = await setup();
    expect(await api.handle("transcript", {})).toMatchObject({ scope: "timeline" });
    expect(JSON.parse(host.snapshot().json).revision).toBe(0);
    await api.handle("captions", {});
    expect(JSON.parse(host.snapshot().json).revision).toBe(0);
    run.mockImplementationOnce(async () => {
      await api.handle("apply", {
        commands: [{ updateProject: { patch: { name: "Human edit" } } }],
      });
      return {
        revision: 0,
        commands: [{ updateProject: { patch: { name: "Agent overwrite" } } }],
        label: "Captions",
        warnings: [],
      };
    });
    await expect(api.handle("captions", { apply: true, expectedRevision: 0 })).rejects.toThrow(
      /expected 0, actual 1/,
    );
    expect(JSON.parse(host.snapshot().json).project.name).toBe("Human edit");
  });
  it("rejects invalid references, unsupported output paths and an absent renderer", async () => {
    const { api, host } = await setup();
    await expect(api.handle("frame", { time: 0, output: "../outside.png" })).rejects.toThrow(
      /Unsafe/,
    );
    await expect(api.handle("restore", { from: 0 })).rejects.toThrow(/Give clips/);
    await expect(api.handle("transcribe", { media: ["missing"] })).rejects.toThrow(/not found/);
    await expect(new ProjectAPI(host).handle("frame", { time: 0 })).rejects.toThrow(
      /attached editor/,
    );
    await expect(api.handle("undo", {})).rejects.toMatchObject({ code: "nothingToUndo" });
    await expect(api.handle("diff", { since: "../outside.tandem" })).rejects.toThrow(/Unsafe/);
  });
  it("writes artifacts exclusively, refuses traversal and symlink escapes, and preserves existing output", async () => {
    const { root, host } = await setup(),
      signal = new AbortController().signal;
    const path = await serviceOutput(
      host.store.path,
      "exports/test.png",
      new Uint8Array([1, 2]),
      signal,
    );
    expect([...(await readFile(path))]).toEqual([1, 2]);
    await expect(
      serviceOutput(host.store.path, "test.png", new Uint8Array([3]), signal),
    ).rejects.toThrow(/exist/);
    expect([...(await readFile(path))]).toEqual([1, 2]);
    await expect(
      serviceOutput(host.store.path, "../test.png", new Uint8Array([3]), signal),
    ).rejects.toThrow(/Unsafe/);
    await expect(
      serviceOutput(host.store.path, "CON.png", new Uint8Array([3]), signal),
    ).rejects.toThrow(/filenames/);
    await rm(join(root, "exports"), { recursive: true });
    // The exports directory is confined to the project, including after symlink resolution.
    const other = await mkdtemp(join(tmpdir(), "sidecut-outside-"));
    clean.push(() => rm(other, { recursive: true, force: true }));
    await symlink(other, join(root, "exports"), process.platform === "win32" ? "junction" : "dir");
    await expect(
      serviceOutput(host.store.path, "test.png", new Uint8Array([3]), signal),
    ).rejects.toThrow(/escapes/);
  });
});
