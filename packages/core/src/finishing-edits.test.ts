import { describe, expect, it } from "vite-plus/test";
import { decodeProjectFile, encodeProjectFile } from "@sidecut/contracts/project";
import { ProjectCoordinator } from "./coordinator";
import { pictureTime, audioRange, exportPlan, sourceTime } from "./render-plan";

const media = {
  id: "m",
  path: "camera.webm",
  role: "camera",
  duration: 20,
  hasVideo: true,
  hasAudio: true,
  takeID: "take",
  takeOffset: 0,
};
const clip = (id: string, start = 0, duration = 2, extra: Record<string, unknown> = {}) => ({
  id,
  start,
  duration,
  sourceStart: start + 1,
  content: { media: { mediaID: "m" } },
  ...extra,
});
const track = (id: string, clips: unknown[], extra: Record<string, unknown> = {}) => ({
  id,
  kind: "video",
  name: id,
  clips,
  ...extra,
});
function setup(video: unknown[] = [], audio: unknown[] = [], items: unknown[] = [media]) {
  return new ProjectCoordinator(
    decodeProjectFile({
      revision: 0,
      project: {
        id: "finishing",
        media: items,
        videoTracks: video,
        audioTracks: audio,
        markers: [{ id: "mark", time: 4 }],
      },
    }),
  );
}
const all = (c: ProjectCoordinator) => [
  ...c.getSnapshot().project.videoTracks,
  ...c.getSnapshot().project.audioTracks,
];
const clips = (c: ProjectCoordinator, id = "v") => all(c).find((t) => t.id === id)!.clips;
const apply = (c: ProjectCoordinator, command: unknown) => c.apply({ commands: [command] });
const paired = () =>
  setup(
    [track("v", [clip("l", 0, 2, { linkGroup: "L" }), clip("r", 2, 2, { linkGroup: "R" })])],
    [
      track("a", [clip("al", 0, 2, { linkGroup: "L" }), clip("ar", 2, 2, { linkGroup: "R" })], {
        kind: "audio",
      }),
    ],
  );

describe("through-edit joins", () => {
  it("accepts a one-sided effect animation at the reference default and refuses a changed default", () => {
    const effectList = [{ id: "fx", type: "blur", params: {} }];
    const c = setup([
      track("v", [
        clip("l", 0, 2, {
          video: { effects: effectList },
          keyframes: {
            "video.effects.fx.radius": [
              { time: 0, value: 20 },
              { time: 2, value: 20 },
            ],
          },
        }),
        clip("r", 2, 2, { video: { effects: effectList } }),
      ]),
    ]);
    apply(c, { join: { clipID: "l" } });
    expect(clips(c)).toHaveLength(1);
    c.undo();
    apply(c, {
      updateClip: {
        clipID: "l",
        patch: {
          keyframes: {
            "video.effects.fx.radius": [
              { time: 0, value: 20 },
              { time: 2, value: 30 },
            ],
          },
        },
      },
    });
    expect(() => apply(c, { join: { clipID: "l" } })).toThrow(/animation/);
  });
  it("joins linked cuts atomically, retains left IDs, merges tags and restores exactly on undo", () => {
    const c = paired(),
      before = encodeProjectFile({ project: c.getSnapshot().project, revision: 0 });
    apply(c, { updateClip: { clipID: "r", patch: { tags: ["keep"] } } });
    apply(c, { join: { clipID: "l" } });
    expect(clips(c).map((x) => [x.id, x.duration.seconds, x.tags])).toEqual([["l", 4, ["keep"]]]);
    expect(clips(c, "a").map((x) => [x.id, x.duration.seconds, x.linkGroup])).toEqual([
      ["al", 4, "L"],
    ]);
    c.undo();
    c.undo();
    expect(encodeProjectFile({ project: c.getSnapshot().project, revision: 0 })).toBe(before);
    c.redo();
    c.redo();
    expect(clips(c)).toHaveLength(1);
  });
  it("treats effect IDs and absent/default properties as equivalent and remaps effect keyframes", () => {
    const fx = (id: string) => ({ id, type: "blur", enabled: true, params: { radius: 0 } });
    const a = clip("l", 0, 2, {
      video: { effects: [fx("fx1")] },
      keyframes: {
        "video.effects.fx1.radius": [
          { time: 0, value: 0 },
          { time: 4, value: 0 },
        ],
      },
    });
    const b = clip("r", 2, 2, {
      video: { effects: [fx("fx2")], opacity: 1 },
      keyframes: {
        "video.effects.fx2.radius": [
          { time: -2, value: 0 },
          { time: 2, value: 0 },
        ],
      },
    });
    const c = setup([track("v", [a, b])]);
    apply(c, { join: { clipID: "l" } });
    expect(clips(c)[0]!.keyframes["video.effects.fx1.radius"]).toEqual([
      { time: 0, value: 0 },
      { time: 4, value: 0 },
    ]);
  });
  it("refuses settings, fades, discontinuity, freeze, transition and animation changes without partial edits", () => {
    for (const extra of [
      { enabled: false },
      { sourceStart: 8 },
      { freezeFrame: true },
      { audio: { fadeIn: 0.1 } },
      { video: { opacity: 0.5 } },
      { keyframes: { "video.opacity": [{ time: 0, value: 0.5 }] } },
    ]) {
      const c = setup([track("v", [clip("l"), clip("r", 2, 2, extra)])]),
        before = c.getSnapshot();
      expect(() => apply(c, { join: { clipID: "l" } })).toThrow();
      expect(c.getSnapshot()).toBe(before);
    }
    const c = setup([
      track("v", [clip("l"), clip("r", 2)], {
        transitions: [{ id: "tr", type: "dissolve", duration: 1, fromClipID: "l", toClipID: "r" }],
      }),
    ]);
    expect(() => apply(c, { join: { clipID: "l" } })).toThrow(/transition/);
  });
  it("rejects a locked or unmatched linked partner and reports each skipped take cut once", () => {
    const c = paired();
    apply(c, { updateTrack: { trackID: "a", patch: { locked: true } } });
    const before = c.getSnapshot();
    expect(() => apply(c, { join: { clipID: "l" } })).toThrow(/locked/);
    expect(c.getSnapshot()).toBe(before);
    const result = apply(c, { joinThroughEdits: {} });
    expect(result.warnings).toHaveLength(1);
    expect(clips(c)).toHaveLength(2);
    const unmatched = paired();
    apply(unmatched, { unlink: { clipIDs: ["ar"] } });
    expect(() => apply(unmatched, { join: { clipID: "l" } })).toThrow(/pair/);
  });
  it("joins a whole run, uses inclusive range edges and explains an empty scan", () => {
    const c = setup([track("v", [clip("l"), clip("r", 2), clip("last", 4)])]);
    apply(c, { joinThroughEdits: { range: { start: 2, duration: 0 } } });
    expect(clips(c)).toHaveLength(2);
    apply(c, { joinThroughEdits: {} });
    expect(clips(c)[0]!.duration.seconds).toBe(6);
    expect(apply(c, { joinThroughEdits: {} }).warnings).toContain("No through-edits to join.");
  });
});
describe("speed, held ranges and patches", () => {
  it("keeps source duration, scales keyframes, ripples linked tracks and markers, and undoes", () => {
    const c = paired();
    apply(c, {
      updateClip: {
        clipID: "l",
        patch: { keyframes: { "video.opacity": [{ time: 1, value: 1 }] } },
      },
    });
    apply(c, { setSpeed: { clipID: "l", speed: 2, ripple: true } });
    expect(
      clips(c).map((x) => [x.start.seconds, x.duration.seconds, x.sourceStart.seconds, x.speed]),
    ).toEqual([
      [0, 1, 1, 2],
      [1, 2, 3, 1],
    ]);
    expect(clips(c, "a")[1]!.start.seconds).toBe(1);
    expect(c.getSnapshot().project.markers[0]!.time).toBe(3);
    expect(clips(c)[0]!.keyframes["video.opacity"]![0]!.time).toBe(0.5);
    c.undo();
    expect(clips(c)[0]!.speed).toBe(1);
    expect(clips(c)[1]!.start.seconds).toBe(2);
    apply(c, { setSpeed: { clipID: "l", speed: 0.5, ripple: true } });
    expect(clips(c)[1]!.start.seconds).toBe(4);
  });
  it("rejects invalid speed, overlap, locked partners, sub-sample durations and freeze primaries atomically", () => {
    const c = paired(),
      before = c.getSnapshot();
    for (const speed of [0, -1, 101, NaN, Infinity, 0.5]) {
      expect(() => apply(c, { setSpeed: { clipID: "l", speed } })).toThrow();
      expect(c.getSnapshot()).toBe(before);
    }
    apply(c, { updateTrack: { trackID: "a", patch: { locked: true } } });
    expect(() => apply(c, { setSpeed: { clipID: "l", speed: 2 } })).toThrow(/locked/);
    const freeze = setup([track("v", [clip("f", 0, 2, { freezeFrame: true })])]);
    expect(() => apply(freeze, { setSpeed: { clipID: "f", speed: 2 } })).toThrow(/freeze/);
    const tiny = setup([track("v", [clip("t", 0, 1 / 48000)])]);
    expect(() => apply(tiny, { setSpeed: { clipID: "t", speed: 100 } })).toThrow();
  });
  it("can edit only the requested clip and maps a fast picture in the render plan", () => {
    const c = paired();
    apply(c, { setSpeed: { clipID: "l", speed: 2, includeLinked: false } });
    expect(clips(c, "a")[0]!.speed).toBe(1);
    expect(sourceTime(clips(c)[0]!, 0.5)).toBe(2);
    apply(c, { updateTrack: { trackID: "a", patch: { muted: true } } });
    expect(exportPlan(c.getSnapshot().project).duration).toBe(4);
  });
  it("holds the frame before the range and cuts only picture while retaining links and source offsets", () => {
    const c = paired();
    apply(c, { holdFrame: { clipID: "l", range: { start: 0.5, duration: 1 } } });
    expect(
      clips(c).map((x) => [x.start.seconds, x.duration.seconds, x.freezeFrame, x.linkGroup]),
    ).toEqual([
      [0, 0.5, false, "L"],
      [0.5, 1, true, "L"],
      [1.5, 0.5, false, "L"],
      [2, 2, false, "R"],
    ]);
    expect(clips(c)[1]!.sourceStart.seconds).toBeCloseTo(1.4666667, 4);
    expect(clips(c, "a")).toHaveLength(2);
    expect(sourceTime(clips(c)[1]!, 1.4)).toBe(clips(c)[1]!.sourceStart.seconds);
    c.undo();
    expect(clips(c)).toHaveLength(2);
    for (const range of [
      { start: -1, duration: 1 },
      { start: 1, duration: 2 },
      { start: 0, duration: 0 },
    ])
      expect(() => apply(c, { holdFrame: { clipID: "l", range } })).toThrow();
    expect(() =>
      apply(c, { holdFrame: { clipID: "al", range: { start: 0, duration: 1 } } }),
    ).toThrow(/video/);
  });
  it("holds head/tail picture edges, silences out-of-source audio, and permits valid held-edge patches", () => {
    const c = setup(
      [track("v", [clip("v1", 0, 4, { sourceStart: -1, holdEdges: true })])],
      [track("a", [clip("a1", 0, 4, { sourceStart: -1, holdEdges: true })], { kind: "audio" })],
      [{ ...media, duration: 2 }],
    );
    const p = c.getSnapshot().project,
      v = clips(c)[0]!,
      a = clips(c, "a")[0]!;
    expect(pictureTime(p, v, 0)).toBe(0);
    expect(pictureTime(p, v, 3.9)).toBeCloseTo(2, 5);
    expect(audioRange(p, a)).toEqual({ from: 0, to: 2 });
    expect(exportPlan(p).duration).toBe(4);
    expect(() => apply(c, { updateClip: { clipID: "v1", patch: { holdEdges: null } } })).toThrow(
      /beginning|end/,
    );
    expect(clips(c)[0]!.holdEdges).toBe(true);
    apply(c, { updateClip: { clipID: "a1", patch: { freezeFrame: true } } });
    expect(audioRange(c.getSnapshot().project, clips(c, "a")[0]!)).toBeNull();
  });
  it("merges patches, clears optional fields with null, restores defaults and rejects malformed batches", () => {
    const c = setup([
      track("v", [
        clip("one", 0, 2, {
          name: "old",
          tags: ["a"],
          video: { opacity: 0.8, transform: { scale: 2 } },
        }),
      ]),
    ]);
    apply(c, {
      updateClip: {
        clipID: "one",
        patch: { name: null, tags: ["b"], enabled: false, video: { transform: { rotation: 30 } } },
      },
    });
    expect(clips(c)[0]).toMatchObject({
      tags: ["b"],
      enabled: false,
      video: { opacity: 0.8, transform: { scale: 2, rotation: 30 } },
    });
    apply(c, { updateClip: { clipID: "one", patch: { enabled: null, tags: null, video: null } } });
    expect(clips(c)[0]).toMatchObject({ enabled: true, tags: [] });
    const before = c.getSnapshot();
    for (const patch of [
      { id: "new" },
      { enabled: "no" },
      { video: { opacity: "bad" } },
      { video: { transform: { scale: "bad" } } },
      { audio: { muted: "no" } },
      { audio: { effects: [{ id: "fx", type: 42 }] } },
      { duration: null },
      { sourceStart: 100 },
      { tags: [1] },
      { content: { media: { mediaID: "missing" } } },
    ]) {
      expect(() =>
        c.apply({
          commands: [
            { updateClip: { clipID: "one", patch: { name: "partial" } } },
            { updateClip: { clipID: "one", patch } },
          ],
        }),
      ).toThrow();
      expect(c.getSnapshot()).toBe(before);
    }
  });
});
describe("role and synced media placement", () => {
  it("rejects overlapping files in an overwrite plan without silently replacing its own new clips", () => {
    const c = setup([], [], [media, { ...media, id: "other" }]),
      before = c.getSnapshot();
    expect(() =>
      apply(c, { placeMedia: { mediaIDs: ["m", "other"], at: 0, mode: "overwrite" } }),
    ).toThrow(/overlap/);
    expect(c.getSnapshot()).toBe(before);
  });
  it("aligns takes that both start before take zero, using the latest negative offset", () => {
    const c = setup(
      [track("v", [], { name: "Camera" }), track("s", [], { name: "Screen" })],
      [],
      [
        { ...media, takeOffset: -3, hasAudio: false },
        { ...media, id: "screen", role: "screen", takeOffset: -2, hasAudio: false },
      ],
    );
    apply(c, { placeMedia: { mediaIDs: ["m", "screen"], at: 0 } });
    expect(
      all(c)
        .flatMap((t) => t.clips)
        .map((x) => x.sourceStart.seconds),
    ).toEqual([1, 0]);
  });
  it("copies partial framing without copying effects/crop to a synced angle", () => {
    const c = setup(
      [
        track("v", [
          clip("cam", 0, 10, {
            sourceStart: 0,
            video: {
              opacity: 0.7,
              crop: { left: 0.1 },
              effects: [{ id: "fx", type: "blur", params: {} }],
              formatOverrides: { portrait: { hidden: true, crop: { left: 0.2 } } },
            },
          }),
        ]),
      ],
      [],
      [media, { ...media, id: "angle", takeOffset: 2, duration: 4 }],
    );
    apply(c, { placeSynced: { mediaID: "angle" } });
    const angle = c.getSnapshot().project.videoTracks[1]!.clips[0]!;
    expect(angle.video).toEqual({ opacity: 0.7, formatOverrides: { portrait: { hidden: true } } });
  });
  it("routes camera picture and levelled voice, links them, keeps deterministic IDs and undoes once", () => {
    const c = setup();
    const command = { placeMedia: { mediaIDs: ["m"], at: 0 } };
    const result = c.apply({ commands: [command], idempotencyKey: "place" });
    const p = c.getSnapshot().project;
    expect(p.videoTracks[0]!.name).toBe("Camera");
    expect(p.audioTracks[0]!.name).toBe("Voice");
    expect(p.audioTracks[0]!.clips[0]!.audio).toMatchObject({ normalizeTo: -20 });
    expect(p.videoTracks[0]!.clips[0]!.linkGroup).toBe(p.audioTracks[0]!.clips[0]!.linkGroup);
    expect(c.apply({ commands: [command], idempotencyKey: "place" })).toBe(result);
    const other = setup();
    expect(other.apply({ commands: [command], idempotencyKey: "place" }).createdIDs).toEqual(
      result.createdIDs,
    );
    c.undo();
    expect(all(c)).toHaveLength(0);
    c.redo();
    expect(all(c)).toHaveLength(2);
  });
  it("aligns a multi-file take by offsets, chooses the shortest remaining duration and warns", () => {
    const c = setup(
      [track("v", [], { name: "Camera" }), track("s", [], { name: "Screen" })],
      [track("a", [], { name: "Voice", kind: "audio" })],
      [
        media,
        {
          ...media,
          id: "screen",
          path: "screen.webm",
          role: "screen",
          takeOffset: 2,
          duration: 10,
        },
      ],
    );
    const result = apply(c, { placeMedia: { mediaIDs: ["m", "screen"], at: 5 } });
    const placed = all(c).flatMap((t) => t.clips);
    expect(placed).toHaveLength(3);
    expect(placed.map((x) => [x.start.seconds, x.duration.seconds, x.sourceStart.seconds])).toEqual(
      [
        [5, 10, 2],
        [5, 10, 0],
        [5, 10, 2],
      ],
    );
    expect(new Set(placed.map((x) => x.linkGroup)).size).toBe(1);
    expect(result.warnings.some((w) => w.includes("runs longer"))).toBe(true);
  });
  it("honors explicit destinations and includeAudio, validates source ranges and rolls back occupied placement", () => {
    const c = setup([track("v", [clip("old")])]);
    const before = c.getSnapshot();
    for (const body of [
      { mediaIDs: [] },
      { mediaIDs: ["missing"] },
      { mediaIDs: ["m"], videoTrackID: "v" },
      { mediaIDs: ["m"], sourceStart: -1 },
      { mediaIDs: ["m"], duration: 50 },
      { mediaIDs: ["m"], speed: 101 },
    ]) {
      expect(() => apply(c, { placeMedia: { at: 0, ...body } })).toThrow();
      expect(c.getSnapshot()).toBe(before);
    }
    apply(c, {
      placeMedia: { mediaIDs: ["m"], at: 2, duration: 1, includeAudio: false, videoTrackID: "v" },
    });
    expect(all(c)).toHaveLength(1);
    expect(clips(c)).toHaveLength(2);
  });
  it("overwrites only destination ranges and opens insert time once for paired picture/sound", () => {
    const c = paired();
    apply(c, {
      placeMedia: {
        mediaIDs: ["m"],
        at: 1,
        duration: 1,
        mode: "insert",
        videoTrackID: "v",
        audioTrackID: "a",
      },
    });
    expect(clips(c).map((x) => [x.start.seconds, x.duration.seconds])).toEqual([
      [0, 1],
      [1, 1],
      [2, 1],
      [3, 2],
    ]);
    expect(clips(c, "a").map((x) => x.start.seconds)).toEqual([0, 1, 2, 3]);
    expect(c.getSnapshot().project.markers[0]!.time).toBe(5);
    c.undo();
    apply(c, {
      placeMedia: {
        mediaIDs: ["m"],
        at: 0.5,
        duration: 1,
        mode: "overwrite",
        includeAudio: false,
        videoTrackID: "v",
      },
    });
    expect(clips(c).map((x) => [x.start.seconds, x.duration.seconds])).toEqual([
      [0, 0.5],
      [0.5, 1],
      [1.5, 0.5],
      [2, 2],
    ]);
    expect(clips(c, "a")).toHaveLength(2);
  });
  it("uses the reference sticker placement and pop data, with renderable scale animation", () => {
    const c = setup(
      [],
      [],
      [
        {
          ...media,
          id: "sticker",
          path: "sticker.png",
          kind: "image",
          role: "sticker",
          hasAudio: false,
          width: 400,
          height: 200,
        },
      ],
    );
    apply(c, { placeMedia: { mediaIDs: ["sticker"], at: 0, pop: true } });
    const p = c.getSnapshot().project,
      placedClip = p.videoTracks[0]!.clips[0]!;
    expect(placedClip.duration.seconds).toBe(5);
    expect(placedClip.video?.transform).toMatchObject({ position: { x: 0.5 }, rotation: 0 });
    expect(placedClip.keyframes["video.transform.scale"]).toHaveLength(6);
    expect(exportPlan(p).duration).toBe(5);
  });
  it("places a synced angle disabled above camera, cuts linked voice at the bounds and preserves take mapping", () => {
    const c = setup(
      [track("v", [clip("cam", 0, 10, { sourceStart: 0, linkGroup: "take" })])],
      [
        track("a", [clip("voice", 0, 10, { sourceStart: 0, linkGroup: "take" })], {
          kind: "audio",
          name: "Voice",
        }),
      ],
      [media, { ...media, id: "angle", path: "angle.webm", takeOffset: 2, duration: 4 }],
    );
    apply(c, { placeSynced: { mediaID: "angle" } });
    const p = c.getSnapshot().project,
      angle = p.videoTracks[1]!.clips[0]!;
    expect(p.videoTracks[1]!.name).toBe("Angle 2");
    expect([
      angle.start.seconds,
      angle.duration.seconds,
      angle.sourceStart.seconds,
      angle.enabled,
    ]).toEqual([2, 4, 0, false]);
    expect(clips(c).map((x) => x.duration.seconds)).toEqual([2, 4, 4]);
    expect(clips(c, "a").map((x) => x.duration.seconds)).toEqual([2, 4, 4]);
    expect(clips(c)[1]!.linkGroup).toBe(angle.linkGroup);
    expect(clips(c, "a")[1]!.linkGroup).toBe(angle.linkGroup);
    const before = c.getSnapshot();
    expect(() => apply(c, { placeSynced: { mediaID: "angle" } })).toThrow(/already/);
    expect(c.getSnapshot()).toBe(before);
    expect(() =>
      apply(c, { moveClips: { clipIDs: [angle.id], delta: 1, mode: "place" } }),
    ).toThrow();
    apply(c, { rippleDeleteRange: { range: { start: 3, duration: 1 } } });
    const remaining = c.getSnapshot().project.videoTracks[1]!.clips;
    expect(
      remaining.map((x) => [x.start.seconds, x.duration.seconds, x.sourceStart.seconds]),
    ).toEqual([
      [2, 1, 0],
      [3, 2, 2],
    ]);
    for (const part of remaining) {
      const cameraPart = clips(c).find((x) => x.start.flicks === part.start.flicks)!;
      const voicePart = clips(c, "a").find((x) => x.start.flicks === part.start.flicks)!;
      expect(cameraPart.sourceStart.subtract(part.sourceStart).seconds).toBe(2);
      expect(voicePart.linkGroup).toBe(part.linkGroup);
    }
  });
  it("replaces the camera's own sound with a synced mic and retains it on a muted track", () => {
    const c = setup(
      [track("v", [clip("cam", 0, 10, { sourceStart: 0, linkGroup: "take" })])],
      [
        track("a", [clip("voice", 0, 10, { sourceStart: 0, linkGroup: "take" })], {
          kind: "audio",
          name: "Voice",
        }),
      ],
      [
        media,
        {
          ...media,
          id: "mic",
          path: "mic.wav",
          kind: "audio",
          hasVideo: false,
          takeOffset: 2,
          duration: 4,
        },
      ],
    );
    apply(c, { placeSynced: { mediaID: "mic" } });
    const p = c.getSnapshot().project,
      backup = p.audioTracks.find((t) => t.name === "Camera sound")!;
    expect(backup.muted).toBe(true);
    expect(backup.clips[0]!.id).not.toBe("voice");
    expect(backup.clips[0]!.duration.seconds).toBe(4);
    const mic = clips(c, "a").find(
      (x) =>
        x.content.media &&
        typeof x.content.media === "object" &&
        "mediaID" in x.content.media &&
        x.content.media.mediaID === "mic",
    )!;
    expect([mic.start.seconds, mic.sourceStart.seconds, mic.duration.seconds]).toEqual([2, 0, 4]);
    expect(mic.linkGroup).toBe(backup.clips[0]!.linkGroup);
    expect(mic.audio?.normalizeTo).toBe(-20);
    c.undo();
    expect(clips(c)).toHaveLength(1);
    expect(clips(c, "a")).toHaveLength(1);
    expect(p.audioTracks.length).toBe(2);
  });
  it("rejects absent sync, missing references, locked linked tracks and nonoverlapping files atomically", () => {
    for (const offset of [30, 0]) {
      const c = setup(
          [track("v", [clip("cam", 0, 10, { sourceStart: 0, linkGroup: "take" })])],
          [
            track("a", [clip("voice", 0, 10, { sourceStart: 0, linkGroup: "take" })], {
              kind: "audio",
              locked: true,
            }),
          ],
          [media, { ...media, id: "angle", takeOffset: offset, duration: 4 }],
        ),
        before = c.getSnapshot();
      expect(() => apply(c, { placeSynced: { mediaID: "angle" } })).toThrow();
      expect(c.getSnapshot()).toBe(before);
    }
    const c = setup([], [], [{ ...media, takeID: null }]);
    expect(() => apply(c, { placeSynced: { mediaID: "m" } })).toThrow(/take/);
    expect(() => apply(setup(), { placeSynced: { mediaID: "m" } })).toThrow(/camera take/);
  });
});
