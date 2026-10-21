import { describe, expect, it } from "vite-plus/test";
import { decodeProjectFile } from "@sidecut/contracts/project";
import { ProjectCoordinator } from "./coordinator";
import empty from "../../../tests/fixtures/tandem/empty.json";
import mini from "../../../tests/fixtures/tandem/mini.json";

describe("media commands", () => {
  it("adds, patches, removes and restores media through undo", () => {
    const session = new ProjectCoordinator(decodeProjectFile(empty));
    session.apply({
      commands: [{ addMedia: { item: { id: "med_new", path: "Tone.wav", kind: "audio" } } }],
    });
    session.apply({
      commands: [
        {
          updateMedia: {
            mediaID: "med_new",
            patch: { role: "music", duration: 2, fingerprint: "synthetic" },
          },
        },
      ],
    });
    expect(session.getSnapshot().project.media[0]).toMatchObject({
      id: "med_new",
      role: "music",
      fingerprint: "synthetic",
    });
    expect(session.getSnapshot().project.media[0]?.duration?.seconds).toBe(2);
    session.apply({ commands: [{ removeMedia: { mediaID: "med_new" } }] });
    expect(session.getSnapshot().project.media).toEqual([]);
    session.undo();
    expect(session.getSnapshot().project.media[0]?.role).toBe("music");
  });
  it("rejects used media, identity changes, duplicate IDs and empty paths atomically", () => {
    const session = new ProjectCoordinator(decodeProjectFile(mini));
    const before = session.getSnapshot();
    expect(() => session.apply({ commands: [{ removeMedia: { mediaID: "med_camera" } }] })).toThrow(
      /used by 1 clip/,
    );
    expect(() =>
      session.apply({
        commands: [{ updateMedia: { mediaID: "med_camera", patch: { id: "changed" } } }],
      }),
    ).toThrow(/cannot change id/);
    expect(() =>
      session.apply({
        commands: [{ addMedia: { item: { id: "med_camera", path: "Other.mov" } } }],
      }),
    ).toThrow(/Duplicate ID/);
    expect(() =>
      session.apply({
        commands: [
          { addMedia: { item: { id: "med_camera", path: "Other.mov" } } },
          { removeMedia: { mediaID: "med_camera" } },
        ],
      }),
    ).toThrow(/Duplicate ID/);
    expect(() =>
      session.apply({
        commands: [{ addMedia: { item: { id: before.project.id, path: "Other.mov" } } }],
      }),
    ).toThrow(/Duplicate ID/);
    expect(() => session.apply({ commands: [{ addMedia: { item: { path: "" } } }] })).toThrow(
      /needs a path/,
    );
    expect(() =>
      session.apply({ commands: [{ updateMedia: { mediaID: "absent", patch: {} } }] }),
    ).toThrow(/not found/);
    expect(session.getSnapshot()).toBe(before);
  });
});
