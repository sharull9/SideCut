import { afterEach, describe, expect, it } from "vite-plus/test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mediaRole, scanFolder, StableFolderWatch } from "./folder-scanner.ts";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
describe("native folder catalogue", () => {
  it("uses reference exclusions, settles changed files, and emits no duplicate imports", async () => {
    const root = await mkdtemp(join(tmpdir(), "sidecut-scan-test-"));
    roots.push(root);
    for (const folder of ["music", "exports", ".tandem", "node_modules", ".hidden"]) {
      await mkdir(join(root, folder));
      await writeFile(join(root, folder, "take.wav"), "media");
    }
    await writeFile(join(root, "recording.mp4.part"), "temporary");
    expect([...(await scanFolder(root)).keys()]).toEqual(["music/take.wav"]);
    const events: string[] = [],
      watcher = new StableFolderWatch(
        root,
        (files) => {
          events.push(...files.map((file) => file.path));
        },
        2000,
      );
    try {
      await watcher.poll(0);
      await watcher.poll(1999);
      expect(events).toEqual([]);
      await watcher.poll(2000);
      await watcher.poll(5000);
      expect(events).toEqual(["music/take.wav"]);
      await writeFile(join(root, "music/take.wav"), "changed media");
      await watcher.poll(6000);
      await watcher.poll(7000);
      expect(events).toHaveLength(1);
      await watcher.poll(8000);
      expect(events).toEqual(["music/take.wav", "music/take.wav"]);
    } finally {
      watcher.close();
    }
  });
  it("matches role precedence and short audio fallback", () => {
    expect(mediaRole("music/take-camera.mov")).toBe("camera");
    expect(mediaRole("sfx/music/song.wav")).toBe("music");
    expect(mediaRole("raw/click.wav")).toBe("sfx");
    expect(mediaRole("raw/take-screen.mp4")).toBe("screen");
    expect(mediaRole("raw/intro.wav", 5)).toBe("sfx");
    expect(mediaRole("raw/intro.wav", 30)).toBe("music");
    expect(mediaRole("overlays/title.png")).toBe("graphic");
  });
});
