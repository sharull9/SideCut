import { describe, it, expect } from "vite-plus/test";
import { cutoutSettings, matteFrameIndex } from "./cutout";
import { ProjectCoordinator } from "./coordinator";
import { decodeProjectFile, encodeProjectFile } from "@sidecut/contracts/project";

describe("cutout edits", () => {
  const repair = {
    shape: "ellipse",
    mode: "include",
    rect: { x: 0.2, y: 0.3, width: 0.1, height: 0.2 },
    feather: 2,
    cornerRadius: 0,
  };
  const session = () =>
    new ProjectCoordinator(
      decodeProjectFile({
        revision: 0,
        project: {
          media: [{ id: "m", kind: "image", path: "person.png" }],
          videoTracks: [
            {
              id: "v",
              kind: "video",
              clips: [{ id: "c", content: { media: { mediaID: "m" } }, duration: 5 }],
            },
          ],
        },
      }),
    );
  it("preserves source-coordinate repairs and undo through project JSON", () => {
    const c = session(),
      before = encodeProjectFile(c.projectFile());
    c.apply({
      label: "Cutout",
      expectedRevision: 0,
      commands: [
        {
          updateClip: {
            clipID: "c",
            patch: { video: { cutout: { enabled: true, repairMasks: [repair] } } },
          },
        },
      ],
    });
    const restored = decodeProjectFile(JSON.parse(encodeProjectFile(c.projectFile())));
    expect(cutoutSettings(restored.project.videoTracks[0]!.clips[0]!.video!.cutout)).toMatchObject({
      mode: "personAndProps",
      edgeFeather: 2,
      repairMasks: [repair],
    });
    c.undo();
    expect(c.getSnapshot().project.videoTracks[0]!.clips[0]!.video).toBeUndefined();
    expect(before).toContain("person.png");
  });
  it("rejects invalid repairs atomically", () => {
    const c = session(),
      before = encodeProjectFile(c.projectFile());
    expect(() =>
      c.apply({
        label: "Bad cutout",
        expectedRevision: 0,
        commands: [
          {
            updateClip: {
              clipID: "c",
              patch: {
                name: "must not stick",
                video: {
                  cutout: { repairMasks: [{ ...repair, rect: { ...repair.rect, x: 0.99 } }] },
                },
              },
            },
          },
        ],
      }),
    ).toThrow();
    expect(encodeProjectFile(c.projectFile())).toBe(before);
    expect(() => cutoutSettings({ edgeFeather: NaN })).toThrow();
  });
  it("maps irregular source timestamps and rejects missing coverage", () => {
    const frames = [
      { timestamp: 0, duration: 0.04 },
      { timestamp: 0.04, duration: 0.08 },
      { timestamp: 0.2, duration: 0.05 },
    ];
    expect(matteFrameIndex(frames, 0.04)).toBe(1);
    expect(matteFrameIndex(frames, 0.11)).toBe(1);
    expect(() => matteFrameIndex(frames, 0.15)).toThrow("incomplete");
    expect(() => matteFrameIndex(frames, 0.26)).toThrow("incomplete");
  });
});
