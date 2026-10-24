import { afterEach, describe, it, expect, vi } from "vite-plus/test";
import { mkdtemp, readFile, rm, symlink } from "node:fs/promises";
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
  const run = vi.fn(async (operation: string) =>
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
