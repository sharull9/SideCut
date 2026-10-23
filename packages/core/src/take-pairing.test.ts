import { describe, it, expect } from "vite-plus/test";
import { decodeProjectFile, encodeProjectFile } from "@sidecut/contracts/project";
import { ProjectCoordinator } from "./coordinator";
import { pairTakes, decodeTakeSidecar, takeName } from "./take-pairing";

function project(paths = ["Record It/main-camera.mov", "Record It/main-screen.mov"]) {
  return decodeProjectFile({
    revision: 0,
    project: {
      media: paths.map((path, i) => ({ id: `m${i}`, path, kind: "video", duration: 20 })),
    },
  });
}
describe("Record It take identification", () => {
  it("pairs by folder and case-insensitive camera/screen suffix while leaving other files alone", () => {
    expect(takeName("clips\\Main-CAMERA.mov")).toEqual({
      folder: "clips/",
      base: "Main",
      role: "camera",
    });
    expect(takeName("main-audio.wav")).toBeNull();
    expect(
      pairTakes(project(["a/main-camera.mov", "b/main-screen.mov"]).project.media).commands,
    ).toHaveLength(0);
    expect(
      pairTakes(project(["main-camera.mov", "main-camera.mp4", "main-screen.mov"]).project.media)
        .notes[0],
    ).toMatch(/ambiguous/);
  });
  it("persists sidecar offsets through commands, undo, and JSON", () => {
    const session = new ProjectCoordinator(project());
    const { commands } = pairTakes(
      session.getSnapshot().project.media,
      new Map([
        [
          "record it/main.take.json",
          decodeTakeSidecar({
            version: 1,
            files: [
              { role: "camera", startHostTime: 81234.512 },
              { role: "screen", startHostTime: 81234.498 },
            ],
          }),
        ],
      ]),
    );
    session.apply({ commands });
    const reopened = decodeProjectFile(JSON.parse(encodeProjectFile(session.projectFile())));
    expect(reopened.project.media[0]!.takeOffset!.seconds).toBeCloseTo(0.014, 5);
    expect(reopened.project.media.map((m) => m.role)).toEqual(["camera", "screen"]);
    expect(new Set(reopened.project.media.map((m) => m.takeID)).size).toBe(1);
    session.undo();
    expect(session.getSnapshot().project.media[0]!.takeID).toBeUndefined();
  });
  it("rejects malformed sidecars and does not silently merge conflicting manual take IDs", () => {
    expect(() => decodeTakeSidecar({ version: 2, files: [] })).toThrow();
    const file = project();
    expect(
      pairTakes(file.project.media.map((m, i) => ({ ...m, takeID: String(i) }))).commands,
    ).toHaveLength(0);
  });
});
