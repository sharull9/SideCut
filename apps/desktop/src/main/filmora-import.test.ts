import { describe, it, expect, afterEach } from "vite-plus/test";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFilmoraSource } from "./filmora-import.ts";
import { NativeProjectStore } from "./project-store.ts";
import { HostProjectService } from "./project-service.ts";
import { ProjectAPI } from "./project-api.ts";

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of cleanup.reverse().splice(0)) await close();
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "sidecut-filmora-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const folder = join(root, "项目 with spaces.wfp.dir/ProjectFolder");
  await mkdir(join(folder, "Medias/main"), { recursive: true });
  await writeFile(
    join(folder, "project_info.json"),
    JSON.stringify({ timeline_mediaId: "main", project_file_name: "Folder fixture" }),
  );
  const doc = {
    currentTimelineId: 1,
    timelineInfos: [
      {
        timelineId: 1,
        userData: [{ key: 3, data: "bWFpbg==" }],
        trackInfos: [
          {
            trackType: 2,
            clipList: [
              {
                type: 2,
                filename: "file:///fixture/take-camera.mov",
                tlBegin: 0,
                tlEnd: 19999999,
                effectChainList: [
                  {
                    effectList: [
                      {
                        id: "audio/effect/volume",
                        paramList: [{ name: "VolumeGain", fxParam: { unValue: -8 } }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
    resources: [],
  };
  await writeFile(join(folder, "Medias/main/timeline.wesproj"), JSON.stringify(doc));
  await writeFile(
    join(folder, "Medias/main/extra.json"),
    JSON.stringify({
      allMarkersInfo: { main: [{ position: 10000000, name: "Review", comments: "Note" }] },
    }),
  );
  return { root, folder, doc };
}

describe("desktop Filmora folders", () => {
  it("imports Unicode/space folders through the host and preserves its prior project on failure", async () => {
    const { root, folder } = await fixture();
    const host = new HostProjectService(new NativeProjectStore(join(root, "current.tandem")));
    await host.start();
    cleanup.push(() => host.close());
    const api = new ProjectAPI(host);
    const initial = host.snapshot();
    await expect(
      api.handle("import-filmora", {
        path: "项目 with spaces.wfp.dir",
        expectedRevision: JSON.parse(initial.json).revision,
        keepLevels: true,
      }),
    ).resolves.toMatchObject({ name: "Folder fixture" });
    const imported = host.snapshot();
    expect(JSON.parse(imported.json).project.audioTracks[0].clips[0].audio.gainDB).toBe(-8);
    expect(JSON.parse(imported.json).project.markers[0]).toMatchObject({ time: 1, note: "Note" });
    await expect(
      api.handle("import-filmora", {
        path: folder,
        expectedRevision: JSON.parse(imported.json).revision - 1,
      }),
    ).rejects.toThrow();
    expect(host.snapshot().json).toBe(imported.json);
    await writeFile(join(folder, "Medias/main/extra.json"), "invalid json");
    await expect(
      api.handle("import-filmora", {
        path: folder,
        expectedRevision: JSON.parse(imported.json).revision,
      }),
    ).rejects.toThrow();
    expect(host.snapshot().json).toBe(imported.json);
  });
  it("refuses metadata escaping via a directory junction and respects cancellation", async () => {
    const { root, folder } = await fixture();
    const outside = await mkdtemp(join(tmpdir(), "sidecut-filmora-external-"));
    cleanup.push(() => rm(outside, { recursive: true, force: true }));
    await writeFile(join(outside, "timeline.wesproj"), "{}");
    await symlink(outside, join(folder, "Medias/external"), "junction");
    await writeFile(join(folder, "project_info.json"), '{"timeline_mediaId":"external"}');
    await expect(readFilmoraSource(root, false, new AbortController().signal)).rejects.toThrow();
    await expect(readFilmoraSource(folder, false, new AbortController().signal)).rejects.toThrow(
      /escapes/,
    );
    const controller = new AbortController();
    controller.abort();
    await expect(readFilmoraSource(folder, false, controller.signal)).rejects.toThrow();
  });
});
