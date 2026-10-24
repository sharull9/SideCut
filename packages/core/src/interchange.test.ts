import { describe, expect, it } from "vite-plus/test";
import { zipSync, strToU8 } from "fflate";
import { decodeProjectFile } from "@sidecut/contracts/project";
import { createArchive, openArchive, readZip } from "./archive";
import { importEDL, importFilmora } from "./interchange";
import { assetUses, recordAssetUse, projectCredits } from "./asset-use";
import { decodeAsset } from "@sidecut/contracts/assets";

describe("portable interchange", () => {
  it("retains library credits, licence copies and relative LUT paths", () => {
    const asset = decodeAsset({
      provider: "local",
      providerID: "logo",
      name: "Logo",
      kind: "logo",
      creditLine: "Fixture maker",
      licenceClass: "creditNeeded",
    });
    const initial = decodeProjectFile({
      revision: 0,
      project: {
        media: [
          {
            id: "med_logo",
            path: "C:/lost/logo.png",
            kind: "image",
            asset,
            look: [{ type: "lut", params: { path: "C:/lost/look.cube" } }],
          },
        ],
      },
    });
    const file = {
      ...initial,
      project: {
        ...initial.project,
        metadata: recordAssetUse(initial.project, {
          asset,
          mediaID: "med_logo",
          path: "C:/lost/logo.png",
        }),
      },
    };
    const resource = (key: string, name: string) => ({
      key,
      name,
      type: "application/octet-stream",
      bytes: new Uint8Array([1]),
    });
    const result = openArchive(
      createArchive(file, [
        resource("med_logo", "logo.png"),
        resource("lut:C:/lost/look.cube", "look.cube"),
        resource("asset-licence:local:logo", "licence.txt"),
      ]),
    );
    expect(assetUses(result.file.project)[0]!.path).toBe("media/0-logo.png");
    expect(result.file.project.media[0]!.look[0]!.params).toEqual({ path: "media/1-look.cube" });
    expect(result.resources.map((r) => r.key)).toContain("lut:media/1-look.cube");
    expect(projectCredits(result.file.project).entries[0]!.line).toBe("Fixture maker");
  });
  it("archives independent snapshots and rejects missing sources and traversal", () => {
    const file = decodeProjectFile({
      revision: 0,
      project: { id: "prj_source", media: [{ id: "med_a", path: "C:/lost/a.wav", kind: "audio" }] },
    });
    expect(() => createArchive(file, [])).toThrow(/missing source/);
    const result = openArchive(
      createArchive(file, [
        { key: "med_a", name: "a.wav", type: "audio/wav", bytes: new Uint8Array([1, 2, 3]) },
      ]),
    );
    expect(result.file.project.id).not.toBe("prj_source");
    expect(result.file.project.media[0]!.path).toBe("media/0-a.wav");
    expect(result.resources[0]!.bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(() => readZip(zipSync({ "../outside": new Uint8Array([1]) }))).toThrow(/Unsafe/);
  });
  it("imports reference EDL take clocks, order, screen offsets and linked sound", () => {
    const { file, report } = importEDL(
      {
        segments: [
          { start: 12, end: 14, layout: "screen", screen_offset: 0.25 },
          { start: 3, end: 4, layout: "cam" },
        ],
      },
      {
        name: "Synthetic recipe",
        takes: [{ start: 0, camera: "take-camera.mov", screen: "take-screen.mov" }],
      },
    );
    const camera = file.project.videoTracks.find((t) => t.name === "Camera")!;
    expect(
      camera.clips.map((c) => [c.start.seconds, c.sourceStart.seconds, c.duration.seconds]),
    ).toEqual([
      [0, 12, 2],
      [2, 3, 1],
    ]);
    expect(file.project.videoTracks[0]!.clips[0]!.sourceStart.seconds).toBe(12.25);
    expect(camera.clips[0]!.linkGroup).toBe(file.project.audioTracks[0]!.clips[0]!.linkGroup);
    expect(report.warnings).toEqual([]);
    expect(() =>
      importEDL(
        { segments: [{ start: 1, end: 0, layout: "cam" }] },
        { name: "Bad", takes: [{ start: 0, camera: "a.mov" }] },
      ),
    ).toThrow(/Invalid EDL/);
    expect(() =>
      importEDL({ segments: [] }, { name: "Bad", takes: [{ start: 0, camera: "../outside.mov" }] }),
    ).toThrow(/Unsafe/);
  });
  it("imports Filmora inclusive ticks, layering, speed, locked tracks and reports omissions", () => {
    const bytes = zipSync({
      "ProjectFolder/project_info.json": strToU8(
        JSON.stringify({
          project_file_name: "Synthetic Filmora",
          timeline_mediaId: "main",
          project_timeline_resolution: [1920, 1080],
          project_timeline_framerate: [25, 1],
        }),
      ),
      "ProjectFolder/Medias/main/timeline.wesproj": strToU8(
        JSON.stringify({
          currentTimelineId: 1,
          timelineInfos: [
            {
              timelineId: 1,
              trackInfos: [
                {
                  trackType: 1,
                  locked: true,
                  clipList: [
                    {
                      type: 1,
                      thisUId: "source",
                      filename: "file:///FIXTURE/camera.mov",
                      tlBegin: 0,
                      tlEnd: 19999999,
                      inPoint: 10000000,
                      speed: {
                        offset: 1,
                        offsetEnd: 5,
                        speedParam: JSON.stringify({
                          keyframeSets: [
                            { _time: 0, _value: 2 },
                            { _time: 100, _value: 1 },
                          ],
                        }),
                      },
                      effectChainList: [],
                    },
                  ],
                },
              ],
            },
          ],
          resources: [],
        }),
      ),
    });
    const { file, report } = importFilmora(bytes);
    const track = file.project.videoTracks[0]!,
      clip = track.clips[0]!;
    expect(track.locked).toBe(true);
    expect([clip.duration.seconds, clip.sourceStart.seconds, clip.speed]).toEqual([2, 1, 2]);
    expect(report.warnings.join(" ")).toMatch(/requires relinking.*effectChainList/);
    expect(() => importFilmora(zipSync({ "wrong.json": strToU8("{}") }))).toThrow(/project_info/);
  });
});
