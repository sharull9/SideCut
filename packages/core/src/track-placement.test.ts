import { describe, expect, it } from "vite-plus/test";
import { decodeProjectFile, encodeProjectFile } from "@sidecut/contracts/project";
import { ProjectCoordinator } from "./coordinator";

function session() {
  return new ProjectCoordinator(
    decodeProjectFile({
      revision: 0,
      project: {
        id: "prj_tracks",
        media: [
          { id: "med_video", path: "clip.webm", duration: 5, hasVideo: true, hasAudio: true },
          { id: "med_audio", path: "tone.wav", kind: "audio", duration: 5 },
        ],
        videoTracks: [{ id: "trk_video", kind: "video", name: "Picture" }],
        audioTracks: [{ id: "trk_audio", kind: "audio", name: "Sound" }],
      },
    }),
  );
}
const insert = (id = "clip_one", start = 0, duration = 1, sourceStart = 0) => ({
  insertClip: {
    trackID: "Picture",
    clip: { id, content: { media: { mediaID: "med_video" } }, start, duration, sourceStart },
  },
});

describe("track and non-ripple placement commands", () => {
  it("clamps add/move indexes, resolves names, publishes created IDs, and restores tracks through undo", () => {
    const value = session();
    const result = value.apply({
      commands: [
        { addTrack: { kind: "video", id: "trk_added", index: -50 } },
        { moveTrack: { trackID: "Picture", index: 100 } },
      ],
    });
    expect(result.createdIDs).toEqual(["trk_added"]);
    expect(value.getSnapshot().project.videoTracks.map((track) => track.id)).toEqual([
      "trk_added",
      "trk_video",
    ]);
    value.apply({
      commands: [
        {
          updateTrack: {
            trackID: "pIcTuRe",
            patch: { locked: true, muted: true, rippleMode: "off" },
          },
        },
      ],
    });
    const roundtrip = decodeProjectFile(JSON.parse(encodeProjectFile(value.getSnapshot())));
    expect(roundtrip.project.videoTracks[1]).toMatchObject({
      locked: true,
      muted: true,
      rippleMode: "off",
    });
    expect(() => value.apply({ commands: [{ removeTrack: { trackID: "Picture" } }] })).toThrow(
      /locked/,
    );
    value.apply({
      commands: [
        { moveTrack: { trackID: "Picture", index: 0 } },
        { updateTrack: { trackID: "Picture", patch: { locked: false } } },
        { removeTrack: { trackID: "Picture" } },
      ],
    });
    value.undo();
    expect(value.getSnapshot().project.videoTracks).toHaveLength(2);
  });
  it("rejects duplicate IDs, ambiguous names, forbidden patches, and locked placement without committing", () => {
    const value = session();
    value.apply({ commands: [{ addTrack: { kind: "audio", name: "Picture", id: "trk_other" } }] });
    const before = value.getSnapshot();
    expect(() =>
      value.apply({ commands: [{ moveTrack: { trackID: "Picture", index: 1 } }] }),
    ).toThrow(/Multiple/);
    expect(() =>
      value.apply({ commands: [{ addTrack: { kind: "video", id: "prj_tracks" } }] }),
    ).toThrow(/Duplicate/);
    expect(() =>
      value.apply({ commands: [{ updateTrack: { trackID: "trk_video", patch: { clips: [] } } }] }),
    ).toThrow(/cannot change/);
    expect(value.getSnapshot()).toBe(before);
    value.apply({ commands: [{ updateTrack: { trackID: "trk_video", patch: { locked: true } } }] });
    expect(() =>
      value.apply({ commands: [{ insertClip: { ...insert().insertClip, trackID: "trk_video" } }] }),
    ).toThrow(/locked/);
  });
  it("sorts placed clips, preserves source in, and treats a placement as one undo entry", () => {
    const value = session();
    const result = value.apply({
      label: "Place two sources",
      commands: [insert("clip_later", 2, 1, 1.5), insert()],
    });
    expect(result.createdIDs).toEqual(["clip_later", "clip_one"]);
    expect(value.getSnapshot().project.videoTracks[0]?.clips.map((clip) => clip.id)).toEqual([
      "clip_one",
      "clip_later",
    ]);
    expect(value.getSnapshot().project.videoTracks[0]?.clips[1]?.sourceStart.seconds).toBe(1.5);
    value.undo();
    expect(value.getSnapshot().project.videoTracks[0]?.clips).toEqual([]);
    value.redo();
    expect(value.getSnapshot().project.videoTracks[0]?.clips).toHaveLength(2);
  });
  it("rejects overlaps, incompatible media, source overruns and unavailable modes atomically", () => {
    const value = session();
    value.apply({ commands: [insert()] });
    const before = value.getSnapshot();
    expect(() => value.apply({ commands: [insert("clip_overlap", 0.5)] })).toThrow(/overlap/);
    expect(() => value.apply({ commands: [insert("clip_overrun", 2, 2, 4)] })).toThrow(
      /past the end/,
    );
    expect(() =>
      value.apply({
        commands: [
          {
            insertClip: {
              trackID: "Picture",
              clip: {
                id: "clip_audio",
                start: 2,
                content: { media: { mediaID: "med_audio" } },
                duration: 1,
              },
            },
          },
        ],
      }),
    ).toThrow(/picture/);
    expect(value.getSnapshot()).toBe(before);
  });
  it("overwrites the covered range of the target track", () => {
    const value = session();
    value.apply({ commands: [insert()] });
    value.apply({
      commands: [
        { insertClip: { ...insert("clip_overwrite", 0.5, 0.25).insertClip, mode: "overwrite" } },
      ],
    });
    const clips = value.getSnapshot().project.videoTracks[0]!.clips;
    expect(
      clips.map((c) => [c.id === "clip_overwrite", c.start.seconds, c.duration.seconds]),
    ).toEqual([
      [false, 0, 0.5],
      [true, 0.5, 0.25],
      [false, 0.75, 0.25],
    ]);
  });
});
