import { afterEach, describe, expect, it } from "vite-plus/test";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostProjectService } from "./project-service.ts";
import { NativeProjectStore } from "./project-store.ts";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "sidecut-project-test-"));
  roots.push(root);
  const path = join(root, "test.tandem"),
    service = new HostProjectService(new NativeProjectStore(path));
  await service.start();
  return { service, path };
}
const edit = (service: HostProjectService, revision: number, name: string) =>
  service.request(
    JSON.stringify({
      type: "apply",
      projectID: JSON.parse(service.snapshot().json).project.id,
      generation: service.snapshot().generation,
      batch: {
        expectedRevision: revision,
        label: "Rename",
        commands: [{ updateProject: { patch: { name } } }],
      },
    }),
  );

describe("host authority and native persistence", () => {
  it("rejects a previous project generation even when its revision is reused", async () => {
    const { service } = await fixture();
    try {
      const before = service.snapshot();
      await service.replace(before.json);
      expect(() =>
        service.request(
          JSON.stringify({
            type: "undo",
            revision: 0,
            projectID: JSON.parse(before.json).project.id,
            generation: before.generation,
          }),
        ),
      ).toThrow(/replaced/);
      expect(service.snapshot().generation).toBe(before.generation + 1);
    } finally {
      await service.close();
    }
  });
  it("shares one revision and undo history across clients and persists after reopen", async () => {
    const { service, path } = await fixture();
    let events = 0;
    const stop = service.subscribe(() => {
      events++;
    });
    expect(edit(service, 0, "First window").result?.revision).toBe(1);
    expect(() => edit(service, 0, "Stale window")).toThrow(/expected 0, actual 1/);
    expect(
      service.request(
        JSON.stringify({
          type: "undo",
          revision: 1,
          projectID: JSON.parse(service.snapshot().json).project.id,
          generation: service.snapshot().generation,
        }),
      ).result?.revision,
    ).toBe(2);
    service.request(
      JSON.stringify({
        type: "redo",
        revision: 2,
        projectID: JSON.parse(service.snapshot().json).project.id,
        generation: service.snapshot().generation,
      }),
    );
    await service.flush();
    stop();
    expect(events).toBeGreaterThan(2);
    await service.close();
    const reopened = new HostProjectService(new NativeProjectStore(path));
    try {
      await reopened.start();
      expect(JSON.parse(reopened.snapshot().json).project.name).toBe("First window");
      expect(JSON.parse(reopened.snapshot().json).revision).toBe(3);
    } finally {
      await reopened.close();
    }
  });
  it("refuses lock contention and rejects malformed or unknown requests without edits", async () => {
    const { service, path } = await fixture();
    try {
      const other = new NativeProjectStore(path);
      await expect(other.acquire()).rejects.toThrow(/locked/);
      const before = service.snapshot().json;
      for (const input of [
        null,
        "{}",
        '{"type":"execute"}',
        '{"type":"apply","batch":{"commands":[{}]}}',
      ])
        expect(() => service.request(input)).toThrow();
      expect(service.snapshot().json).toBe(before);
    } finally {
      await service.close();
    }
  });
  it("preserves external edits and offers explicit reload and backup recovery", async () => {
    const { service, path } = await fixture();
    try {
      edit(service, 0, "Saved version");
      await service.flush();
      const saved = await readFile(path, "utf8");
      const external = JSON.parse(saved);
      external.project.name = "External version";
      delete external.sidecutJournal;
      await writeFile(path, JSON.stringify(external));
      edit(service, 1, "Unsaved version");
      await expect(service.flush()).rejects.toThrow(/outside SideCut/);
      expect(JSON.parse(await readFile(path, "utf8")).project.name).toBe("External version");
      expect(JSON.parse((await service.replace()).json).project.name).toBe("External version");
      await writeFile(path, "interrupted invalid JSON");
      const recovered = await service.replace(undefined, true);
      expect(JSON.parse(recovered.json).project.name).toBe("Untitled sequence");
      expect(() => JSON.parse(saved)).not.toThrow();
    } finally {
      await service.close();
    }
  });
  it("ignores an interrupted temporary write and retains a valid backup", async () => {
    const { service, path } = await fixture();
    edit(service, 0, "Valid");
    await service.flush();
    await service.close();
    await writeFile(`${path}.interrupted.tmp`, "partial");
    const next = new NativeProjectStore(path);
    try {
      await next.acquire();
      const file = await next.load(() => {
        throw new Error("Should load existing");
      });
      expect(file.project.name).toBe("Valid");
      expect(JSON.parse(await readFile(`${path}.bak`, "utf8")).project.name).toBe(
        "Untitled sequence",
      );
    } finally {
      await next.close();
    }
  });
});
