import { it, expect } from "vite-plus/test";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NativeProjectStore } from "./project-store.ts";
import { HostProjectService } from "./project-service.ts";
import { decodeProjectFile } from "@sidecut/contracts/project";
import { ProjectCoordinator } from "@sidecut/core/coordinator";

it("hosts portable projects without rewriting reads, saves shared edits, and retains undo on reopen", async () => {
  const root = await mkdtemp(join(tmpdir(), "sidecut-portable-host-"));
  const path = join(root, "Edit 项目.tandem");
  const initial = JSON.stringify({ revision: 0, project: { id: "portable", name: "Original" } });
  await writeFile(path, initial);
  const first = new HostProjectService(
    new NativeProjectStore(path, { portable: true, databasePath: join(root, "first.sqlite") }),
  );
  let second: HostProjectService | undefined;
  try {
    await first.start();
    expect(first.snapshot().saveState).toBe("saved");
    expect(await readFile(path, "utf8")).toBe(initial);
    const competitor = new NativeProjectStore(path);
    await expect(competitor.acquire()).rejects.toThrow(/locked/);
    first.request(
      JSON.stringify({
        type: "apply",
        projectID: "portable",
        generation: first.snapshot().generation,
        batch: { commands: [{ updateProject: { patch: { name: "Changed" } } }] },
      }),
    );
    await first.flush();
    const saved = decodeProjectFile(JSON.parse(await readFile(path, "utf8")));
    expect(saved.project.name).toBe("Changed");
    expect(saved.revision).toBe(1);
    const replay = new ProjectCoordinator(saved);
    replay.undo();
    expect(replay.getSnapshot().project.name).toBe("Original");
    await first.close();
    second = new HostProjectService(
      new NativeProjectStore(path, { portable: true, databasePath: join(root, "second.sqlite") }),
    );
    await second.start();
    expect(JSON.parse(second.snapshot().json).project.name).toBe("Changed");
    await writeFile(path, initial);
    second.request(
      JSON.stringify({
        type: "apply",
        projectID: "portable",
        generation: second.snapshot().generation,
        batch: {
          commands: [{ updateProject: { patch: { name: "Must not overwrite external file" } } }],
        },
      }),
    );
    await expect(second.flush()).rejects.toThrow(/changed outside/);
    expect(await readFile(path, "utf8")).toBe(initial);
  } finally {
    await second?.close();
    await first.close();
    await rm(root, { recursive: true, force: true });
  }
});
