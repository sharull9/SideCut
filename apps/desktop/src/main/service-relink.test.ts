import { afterEach, expect, it } from "vite-plus/test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { decodeProjectFile } from "@sidecut/contracts/project";
import { relinkPlan, fileFingerprint } from "./service-relink.ts";
import { ProjectAPI } from "./project-api.ts";
import { HostProjectService } from "./project-service.ts";
import { NativeProjectStore } from "./project-store.ts";
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
it("stops staging when another edit changes the project", async () => {
  const root = await setup();
  await writeFile(join(root, "one", "a.wav"), "a");
  await writeFile(join(root, "one", "b.wav"), "b");
  const host = new HostProjectService(new NativeProjectStore(join(root, "current.tandem")));
  await host.start();
  try {
    const plain = new ProjectAPI(host);
    await plain.handle("apply", {
      commands: [
        { addMedia: { item: { id: "a", kind: "audio", path: "lost/a.wav" } } },
        { addMedia: { item: { id: "b", kind: "audio", path: "lost/b.wav" } } },
      ],
    });
    const staged: string[] = [];
    const live = new ProjectAPI(host, undefined, {
      run: async (_operation, input) => {
        staged.push(String(input.mediaID));
        await plain.handle("apply", {
          commands: [{ updateProject: { patch: { name: "Concurrent edit" } } }],
        });
        return { staged: input.mediaID };
      },
      screenshot: async () => new Uint8Array(),
    });
    await expect(live.handle("relink", {})).rejects.toThrow("changed during relink");
    expect(staged).toEqual(["a"]);
    const file = JSON.parse(host.snapshot().json);
    expect(file.revision).toBe(2);
    expect(file.project.name).toBe("Concurrent edit");
    expect(file.project.media.map((m: { path: string }) => m.path)).toEqual([
      "lost/a.wav",
      "lost/b.wav",
    ]);
  } finally {
    await host.close();
  }
});
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "sidecut-relink-"));
  roots.push(root);
  await mkdir(join(root, "one"));
  await mkdir(join(root, "two"));
  await writeFile(join(root, "one", "source.wav"), "first");
  await writeFile(join(root, "two", "source.wav"), "second");
  return root;
}
const signal = () => new AbortController().signal;
it("matches sampled fingerprints, preserves ambiguity, ignores duplicate roots and supports Live Photo companions", async () => {
  const root = await setup(),
    fingerprint = await fileFingerprint(join(root, "two", "source.wav"), signal());
  await writeFile(join(root, "one", "still.jpg"), "image");
  await writeFile(join(root, "one", "still.mov"), "movie");
  const file = decodeProjectFile({
    revision: 0,
    project: {
      media: [
        { id: "known", kind: "audio", path: "old/source.wav", fingerprint },
        { id: "unknown", kind: "audio", path: "else/source.wav" },
        { id: "photo", kind: "image", path: "old/still.jpg", livePhotoVideo: "old/still.mov" },
        { id: "missing", kind: "image", path: "missing.jpg" },
      ],
    },
  });
  const plan = await relinkPlan(file, root, { search: ["one"] }, signal());
  expect(plan.result.relinked).toEqual([
    { mediaID: "known", from: "old/source.wav", to: "two/source.wav" },
    { mediaID: "photo", from: "old/still.jpg", to: "one/still.jpg" },
  ]);
  expect(plan.result.missing).toEqual([
    { mediaID: "unknown", path: "else/source.wav", clips: 0, ambiguous: true },
    { mediaID: "missing", path: "missing.jpg", clips: 0, ambiguous: false },
  ]);
  expect(plan.commands[1]?.updateMedia.patch.livePhotoVideo).toBe("one/still.mov");
  await expect(relinkPlan(file, root, { search: ["absent"] }, signal())).rejects.toThrow(
    "no folder",
  );
  const controller = new AbortController();
  controller.abort();
  await expect(relinkPlan(file, root, {}, controller.signal)).rejects.toThrow();
});
it("keeps dry runs read-only and applies multiple matches in one undoable host edit", async () => {
  const root = await setup();
  await writeFile(join(root, "one", "unique.wav"), "unique");
  const host = new HostProjectService(new NativeProjectStore(join(root, "current.tandem")));
  await host.start();
  try {
    const api = new ProjectAPI(host, undefined, {
      run: async () => ({ staged: true }),
      screenshot: async () => new Uint8Array(),
    });
    await api.handle("apply", {
      commands: [
        { addMedia: { item: { id: "a", kind: "audio", path: "old/unique.wav" } } },
        {
          addMedia: {
            item: {
              id: "b",
              kind: "audio",
              path: "old/source.wav",
              fingerprint: await fileFingerprint(join(root, "one", "source.wav"), signal()),
            },
          },
        },
      ],
    });
    const plain = new ProjectAPI(host);
    expect(await plain.handle("relink", { dryRun: true })).toMatchObject({
      revision: 1,
      dryRun: true,
      relinked: [{ mediaID: "a" }, { mediaID: "b" }],
    });
    const staged: string[] = [];
    const renderer = {
      run: async (_operation: string, input: Record<string, unknown>) => {
        staged.push(String(input.mediaID));
        return { staged: input.mediaID };
      },
      screenshot: async () => new Uint8Array(),
    };
    const live = new ProjectAPI(host, undefined, renderer);
    const failure = new ProjectAPI(host, undefined, {
      ...renderer,
      run: async (_operation, input) => {
        if (input.mediaID === "b") throw new Error("Fixture staging failed");
        return { staged: input.mediaID };
      },
    });
    await expect(failure.handle("relink", {})).rejects.toThrow("staging failed");
    expect(JSON.parse(host.snapshot().json).revision).toBe(1);
    expect(await live.handle("relink", { expectedRevision: 1 })).toMatchObject({
      revision: 2,
      applied: { revision: 2 },
    });
    expect(staged).toEqual(["a", "b"]);
    await plain.handle("undo", {});
    expect(
      JSON.parse(host.snapshot().json).project.media.map((m: { path: string }) => m.path),
    ).toEqual(["old/unique.wav", "old/source.wav"]);
    await expect(plain.handle("relink", { expectedRevision: 1 })).rejects.toThrow("revision");
  } finally {
    await host.close();
  }
});
