import { describe, expect, it } from "vite-plus/test";
import { decodeProjectFile } from "@sidecut/contracts/project";
import { ProjectCoordinator } from "./coordinator";

const clip = (
  id: string,
  start: number,
  duration: number,
  extra: Record<string, unknown> = {},
) => ({ id, start, duration, sourceStart: 2, content: { media: { mediaID: "media" } }, ...extra });
const track = (id: string, clips: unknown[], extra: Record<string, unknown> = {}) => ({
  id,
  name: id,
  kind: "video",
  rippleMode: "cut",
  clips,
  ...extra,
});
function setup(video: unknown[], audio: unknown[] = [], markers: unknown[] = []) {
  return new ProjectCoordinator(
    decodeProjectFile({
      revision: 0,
      project: {
        id: "advanced",
        media: [
          { id: "media", path: "source.webm", hasVideo: true, hasAudio: true, duration: 100 },
        ],
        videoTracks: video,
        audioTracks: audio,
        markers,
      },
    }),
  );
}
const sequence = (value: ProjectCoordinator, id = "picture") =>
  [...value.getSnapshot().project.videoTracks, ...value.getSnapshot().project.audioTracks].find(
    (t) => t.id === id,
  )!.clips;
const ranges = (value: ProjectCoordinator, id = "picture") =>
  sequence(value, id).map((c) => [c.start.seconds, c.duration.seconds, c.sourceStart.seconds]);
const three = () => [
  clip("left", 0, 2, { linkGroup: "L" }),
  clip("middle", 2, 2, { sourceStart: 4, linkGroup: "M" }),
  clip("right", 4, 2, { sourceStart: 6, linkGroup: "R" }),
];
const linked = () =>
  setup(
    [track("picture", three())],
    [
      track(
        "sound",
        three().map((c) => ({ ...c, id: `a_${c.id}` })),
        { kind: "audio" },
      ),
    ],
  );

describe("range cutting and insertion", () => {
  it("unions overlapping cuts and applies disjoint ranges backwards without removing time twice", () => {
    const value = setup([track("picture", [clip("v", 0, 10)])]);
    value.apply({
      commands: [
        {
          cutRanges: {
            ranges: [
              { start: 2, duration: 2 },
              { start: 3, duration: 2 },
              { start: 7, duration: 1 },
            ],
          },
        },
      ],
    });
    expect(ranges(value)).toEqual([
      [0, 2, 2],
      [2, 2, 7],
      [4, 2, 10],
    ]);
    value.undo();
    expect(ranges(value)).toEqual([[0, 10, 2]]);
    const before = value.getSnapshot();
    for (const inputRanges of [[], [{ start: -1, duration: 1 }], [{ start: 0, duration: 0 }]])
      expect(() => value.apply({ commands: [{ cutRanges: { ranges: inputRanges } }] })).toThrow();
    expect(value.getSnapshot()).toBe(before);
  });
  it("closes a real gap and refuses destructive closure across other cut tracks, even locked ones", () => {
    const value = setup([
      track("picture", [clip("v", 0, 2), clip("later", 4, 2)]),
      track("follow", [clip("overlay", 0, 8)], { rippleMode: "follow" }),
    ]);
    value.apply({ commands: [{ closeGap: { trackID: "PICTURE", at: 3 } }] });
    expect(ranges(value)).toEqual([
      [0, 2, 2],
      [2, 2, 2],
    ]);
    expect(ranges(value, "follow")).toEqual([[0, 6, 2]]);
    for (const at of [1, 9])
      expect(() => value.apply({ commands: [{ closeGap: { trackID: "picture", at } }] })).toThrow();
    const blocked = setup([
      track("picture", [clip("v", 4, 2)]),
      track("other", [clip("occupied", 1, 1)], { locked: true }),
    ]);
    const before = blocked.getSnapshot();
    expect(() =>
      blocked.apply({ commands: [{ closeGap: { trackID: "picture", at: 2 } }] }),
    ).toThrow(/would cut/);
    expect(blocked.getSnapshot()).toBe(before);
  });
  it("inserts on the nearest cut within half a frame, shifts later followers, and keeps exact-boundary markers", () => {
    const value = setup(
      [
        track("picture", [clip("v", 0, 2), clip("later", 2, 2)]),
        track("follow", [clip("span", 0, 2), clip("follower", 2, 3)], { rippleMode: "follow" }),
        track("off", [clip("fixed", 2, 2)], { rippleMode: "off" }),
        track("locked", [clip("locked_v", 2, 2)], { locked: true }),
      ],
      [],
      [
        { id: "at", time: 2, duration: 2 },
        { id: "after", time: 3, duration: 0 },
      ],
    );
    const result = value.apply({ commands: [{ insertTime: { at: 1.99, duration: 1 } }] });
    expect(ranges(value)).toEqual([
      [0, 2, 2],
      [3, 2, 2],
    ]);
    expect(ranges(value, "follow")).toEqual([
      [0, 2, 2],
      [3, 3, 2],
    ]);
    expect(ranges(value, "off")).toEqual([[2, 2, 2]]);
    expect(ranges(value, "locked")).toEqual([[2, 2, 2]]);
    expect(value.getSnapshot().project.markers.map((m) => [m.time, m.duration])).toEqual([
      [2, 2],
      [4, 0],
    ]);
    expect(result.warnings.join(" ")).toMatch(/Locked/);
    expect(result.createdIDs).toEqual([]);
  });
  it("splits cut tracks but retains a spanning follow clip and warns for short pieces", () => {
    const value = setup([
      track("picture", [clip("v", 0, 2)]),
      track("follow", [clip("span", 0, 5)], { rippleMode: "follow" }),
    ]);
    const result = value.apply({ commands: [{ insertTime: { at: 1.8, duration: 1 } }] });
    expect(ranges(value, "follow")).toEqual([[0, 5, 2]]);
    expect(sequence(value)[1]!.start.seconds).toBeCloseTo(2.8);
    expect(sequence(value)[1]!.sourceStart.seconds).toBeCloseTo(3.8);
    expect(result.warnings.join(" ")).toMatch(/short piece/);
    expect(() => value.apply({ commands: [{ insertTime: { at: 0, duration: 0 } }] })).toThrow(
      /positive/,
    );
  });
  it("uses sample-rounded half-frame reach at fractional frame rates", () => {
    const value = setup([track("picture", [clip("v", 0, 2), clip("next", 2, 2)])]);
    value.apply({
      commands: [
        { updateSettings: { patch: { frameRate: { numerator: 30000, denominator: 1001 } } } },
      ],
    });
    value.apply({ commands: [{ insertTime: { at: 2 - 801 / 48000, duration: 1 } }] });
    expect(ranges(value)).toEqual([
      [0, 2, 2],
      [3, 2, 2],
    ]);
  });
  it("keeps explicitly local insertion local and does nothing by default without cut tracks", () => {
    const value = setup(
      [
        track("picture", [clip("v", 0, 4)], { rippleMode: "follow" }),
        track("other", [clip("other_clip", 2, 2)], { rippleMode: "follow" }),
      ],
      [],
      [{ id: "mark", time: 3 }],
    );
    value.apply({ commands: [{ insertTime: { at: 1, duration: 1 } }] });
    expect(ranges(value)).toEqual([[0, 4, 2]]);
    value.apply({ commands: [{ insertTime: { at: 1, duration: 1, trackIDs: ["picture"] } }] });
    expect(ranges(value)).toEqual([
      [0, 1, 2],
      [2, 3, 3],
    ]);
    expect(ranges(value, "other")).toEqual([[2, 2, 2]]);
    expect(value.getSnapshot().project.markers[0]!.time).toBe(3);
  });
  it("inserts a source atomically with deterministic split IDs, and rejects invalid placement without moving anything", () => {
    const value = setup([track("picture", [clip("v", 0, 4)])]);
    const result = value.apply({
      commands: [{ insertClip: { trackID: "picture", mode: "insert", clip: clip("new", 1, 1) } }],
    });
    expect(ranges(value)).toEqual([
      [0, 1, 2],
      [1, 1, 2],
      [2, 3, 3],
    ]);
    expect(result.createdIDs).toHaveLength(2);
    expect(result.createdIDs[1]).toBe("new");
    value.undo();
    const before = value.getSnapshot();
    for (const c of [clip("v", 1, 1), clip("bad", 1, 101), clip("negative", -1, 1)])
      expect(() =>
        value.apply({
          commands: [{ insertClip: { trackID: "picture", mode: "insert", clip: c } }],
        }),
      ).toThrow();
    expect(value.getSnapshot()).toBe(before);
  });
});

describe("ripple trim, roll, slip and slide", () => {
  it("maps other cut/follow/off tracks and exact-boundary markers during ripple trim", () => {
    const value = setup(
      [
        track("picture", [clip("v", 0, 2)]),
        track("cut", [clip("cut_v", 0, 6)]),
        track("follow", [clip("follow_v", 0, 6)], { rippleMode: "follow" }),
        track("off", [clip("off_v", 0, 6)], { rippleMode: "off" }),
      ],
      [],
      [
        { id: "inside", time: 1.75 },
        { id: "after", time: 3 },
      ],
    );
    value.apply({ commands: [{ trim: { clipID: "v", edge: "end", to: 1.5, ripple: true } }] });
    expect(ranges(value, "cut")).toEqual([
      [0, 1.5, 2],
      [1.5, 4, 4],
    ]);
    expect(ranges(value, "follow")).toEqual([[0, 5.5, 2]]);
    expect(ranges(value, "off")).toEqual([[0, 6, 2]]);
    expect(value.getSnapshot().project.markers.map((m) => m.time)).toEqual([1.5, 2.5]);
  });
  it("closes sub-millisecond overlap slivers after edge edits without shifting the source content", () => {
    const value = setup([
      track("picture", [clip("left", 0, 2), clip("right", 2, 2, { sourceStart: 4 })]),
    ]);
    value.apply({ commands: [{ trim: { clipID: "left", edge: "end", to: 2.0005 } }] });
    const [left, right] = sequence(value);
    expect(right!.start.flicks).toBe(left!.start.flicks + left!.duration.flicks);
    expect(right!.sourceStart.seconds).toBeCloseTo(4.0005, 6);
    expect(right!.start.seconds + right!.duration.seconds).toBe(4);
  });
  it("ripple-trims heads in place and shifts linked neighbors and markers together", () => {
    const value = linked();
    value.apply({ commands: [{ trim: { clipID: "left", edge: "start", to: 0.5, ripple: true } }] });
    expect(ranges(value)).toEqual([
      [0, 1.5, 2.5],
      [1.5, 2, 4],
      [3.5, 2, 6],
    ]);
    expect(ranges(value, "sound")).toEqual(ranges(value));
    value.undo();
    expect(ranges(value)).toEqual([
      [0, 2, 2],
      [2, 2, 4],
      [4, 2, 6],
    ]);
  });
  it("grows ripple tails once across linked tracks and moves markers on the old cut", () => {
    const value = setup(
      [
        track("picture", three()),
        track("follow", [clip("overlay", 0, 6)], { rippleMode: "follow" }),
      ],
      [
        track(
          "sound",
          three().map((c) => ({ ...c, id: `a_${c.id}` })),
          { kind: "audio" },
        ),
      ],
      [{ id: "marker", time: 2, duration: 1 }],
    );
    value.apply({ commands: [{ trim: { clipID: "left", edge: "end", to: 2.5, ripple: true } }] });
    expect(ranges(value)).toEqual([
      [0, 2.5, 2],
      [2.5, 2, 4],
      [4.5, 2, 6],
    ]);
    expect(ranges(value, "sound")).toEqual(ranges(value));
    expect(ranges(value, "follow")).toEqual([[0, 6, 2]]);
    expect(value.getSnapshot().project.markers[0]!.time).toBe(2.5);
  });
  it("shrinks tails, grows heads using source handles, and rejects overruns or locked partners atomically", () => {
    const value = linked();
    value.apply({ commands: [{ trim: { clipID: "left", edge: "end", to: 1.5, ripple: true } }] });
    expect(ranges(value)[1]).toEqual([1.5, 2, 4]);
    value.apply({
      commands: [{ trim: { clipID: "left", edge: "start", to: -0.5, ripple: true } }],
    });
    expect(ranges(value)[0]).toEqual([0, 2, 1.5]);
    value.apply({ commands: [{ updateTrack: { trackID: "sound", patch: { locked: true } } }] });
    const before = value.getSnapshot();
    expect(() =>
      value.apply({ commands: [{ trim: { clipID: "left", edge: "end", to: 3, ripple: true } }] }),
    ).toThrow(/locked/);
    expect(value.getSnapshot()).toBe(before);
    expect(() =>
      value.apply({
        commands: [
          { trim: { clipID: "left", edge: "start", to: -10, ripple: true, includeLinked: false } },
        ],
      }),
    ).toThrow(/before/);
    expect(value.getSnapshot()).toBe(before);
  });
  it("rolls paired cuts without changing total length and checks both source handles", () => {
    const value = linked();
    value.apply({
      commands: [{ roll: { leftClipID: "left", rightClipID: "middle", delta: 0.5 } }],
    });
    expect(ranges(value)).toEqual([
      [0, 2.5, 2],
      [2.5, 1.5, 4.5],
      [4, 2, 6],
    ]);
    expect(ranges(value, "sound")).toEqual(ranges(value));
    value.undo();
    const before = value.getSnapshot();
    expect(() =>
      value.apply({ commands: [{ roll: { leftClipID: "left", rightClipID: "right", delta: 1 } }] }),
    ).toThrow(/meet/);
    expect(() =>
      value.apply({
        commands: [{ roll: { leftClipID: "left", rightClipID: "middle", delta: 3 } }],
      }),
    ).toThrow(/duration/);
    expect(() =>
      value.apply({
        commands: [{ roll: { leftClipID: "left", rightClipID: "a_middle", delta: 0.1 } }],
      }),
    ).toThrow(/same track/);
    expect(value.getSnapshot()).toBe(before);
    const handles = setup([
      track("picture", [clip("l", 0, 2, { sourceStart: 98 }), clip("r", 2, 2)]),
    ]);
    expect(() =>
      handles.apply({ commands: [{ roll: { leftClipID: "l", rightClipID: "r", delta: 0.5 } }] }),
    ).toThrow(/past the end/);
  });
  it("slips source time directly even at non-unit speed and can exclude linked partners", () => {
    const value = linked();
    value.apply({ commands: [{ slip: { clipID: "middle", delta: 0.5 } }] });
    expect(ranges(value)[1]).toEqual([2, 2, 4.5]);
    expect(ranges(value, "sound")[1]).toEqual([2, 2, 4.5]);
    value.apply({ commands: [{ slip: { clipID: "middle", delta: -0.25, includeLinked: false } }] });
    expect(ranges(value)[1]).toEqual([2, 2, 4.25]);
    expect(ranges(value, "sound")[1]).toEqual([2, 2, 4.5]);
    const before = value.getSnapshot();
    expect(() => value.apply({ commands: [{ slip: { clipID: "middle", delta: -20 } }] })).toThrow(
      /before/,
    );
    expect(value.getSnapshot()).toBe(before);
    const fast = setup([track("picture", [clip("fast", 0, 2, { speed: 2 })])]);
    fast.apply({ commands: [{ slip: { clipID: "fast", delta: 1 } }] });
    expect(ranges(fast)).toEqual([[0, 2, 3]]);
  });
  it("slides linked clips, trims touching neighbors, and preserves the sequence end", () => {
    const value = linked();
    value.apply({ commands: [{ slide: { clipID: "middle", delta: 0.5 } }] });
    expect(ranges(value)).toEqual([
      [0, 2.5, 2],
      [2.5, 2, 4],
      [4.5, 1.5, 6.5],
    ]);
    expect(ranges(value, "sound")).toEqual(ranges(value));
    value.undo();
    const before = value.getSnapshot();
    expect(() => value.apply({ commands: [{ slide: { clipID: "middle", delta: 2 } }] })).toThrow(
      /swallow/,
    );
    expect(value.getSnapshot()).toBe(before);
    value.apply({ commands: [{ updateTrack: { trackID: "sound", patch: { locked: true } } }] });
    const locked = value.getSnapshot();
    expect(() => value.apply({ commands: [{ slide: { clipID: "middle", delta: 0.1 } }] })).toThrow(
      /locked/,
    );
    expect(value.getSnapshot()).toBe(locked);
  });
});
