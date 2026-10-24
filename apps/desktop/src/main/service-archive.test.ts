import { afterEach, it, expect } from "vite-plus/test";
import { mkdtemp, mkdir, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { decodeProjectFile } from "@sidecut/contracts/project";
import { ProjectCoordinator } from "@sidecut/core/coordinator";
import { createArchive, openArchive } from "@sidecut/core/archive";
import { folderArchive } from "./service-archive.ts";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "sidecut-folder-"));
  roots.push(root);
  const projectPath = join(root, "managed", "current.tandem");
  await mkdir(join(root, "managed"));
  const file = decodeProjectFile({
    revision: 0,
    project: {
      id: "folder",
      media: [
        { id: "m", path: "old.wav", kind: "audio", hasAudio: true },
        { id: "missing", path: "missing.wav", kind: "audio", hasAudio: true },
      ],
    },
  });
  const bytes = createArchive(
    file,
    [{ key: "m", name: "source.wav", type: "audio/wav", bytes: new Uint8Array([1, 2, 3]) }],
    { allowMissing: true, preserveIdentity: true },
  );
  return { root, projectPath, file, bytes };
}
it("plans without writing, publishes a standalone folder and refuses overwrites", async () => {
  const { root, projectPath, file, bytes } = await setup();
  const apply = () => {
    throw new Error("Copy mode must not edit the source");
  };
  const request = { to: join(root, "destination"), withCache: false };
  const dry = await folderArchive(
    projectPath,
    file,
    bytes,
    { ...request, dryRun: true },
    new AbortController().signal,
    apply,
  );
  await expect(stat(dry.folder)).rejects.toThrow();
  expect(dry).toMatchObject({
    mode: "archive",
    collected: [{ outcome: "planned", bytes: 3 }],
    missing: [{ path: "missing.wav" }],
  });
  const written = await folderArchive(
    projectPath,
    file,
    bytes,
    request,
    new AbortController().signal,
    apply,
  );
  expect(openArchive(new Uint8Array(await readFile(written.openFile))).resources[0]?.bytes).toEqual(
    new Uint8Array([1, 2, 3]),
  );
  expect(JSON.parse(await readFile(written.projectFile, "utf8")).project.id).toBe("folder");
  await expect(
    folderArchive(projectPath, file, bytes, request, new AbortController().signal, apply),
  ).rejects.toThrow(/exists/);
  await expect(
    folderArchive(
      projectPath,
      file,
      bytes,
      { to: join(root, "managed", "nested"), dryRun: true },
      new AbortController().signal,
      apply,
    ),
  ).rejects.toThrow(/outside/);
});
it("consolidates through one undoable batch and leaves copies after undo", async () => {
  const { projectPath, file, bytes } = await setup(),
    coordinator = new ProjectCoordinator(file);
  const result = await folderArchive(
    projectPath,
    file,
    bytes,
    {},
    new AbortController().signal,
    (commands) => coordinator.apply({ label: "Consolidate", commands }),
  );
  expect(coordinator.getSnapshot().revision).toBe(1);
  expect(coordinator.getSnapshot().project.media[0]?.path).toBe("media/0-source.wav");
  coordinator.undo();
  expect(coordinator.getSnapshot().project).toEqual(file.project);
  expect(await readFile(join(result.folder, "media/0-source.wav"))).toEqual(Buffer.from([1, 2, 3]));
});
it("cancels before copying and preserves the source", async () => {
  const { root, projectPath, file, bytes } = await setup(),
    controller = new AbortController();
  controller.abort();
  await expect(
    folderArchive(
      projectPath,
      file,
      bytes,
      { to: join(root, "cancel") },
      controller.signal,
      () => {},
    ),
  ).rejects.toThrow();
  await expect(stat(join(root, "cancel"))).rejects.toThrow();
});
