import { describe, expect, it } from "vite-plus/test";
import { decodeProjectFile, encodeProjectFile } from "@sidecut/contracts/project";
import { ProjectCoordinator } from "./coordinator";
import { EditContext } from "./timeline-editing";

const clip = (id: string, start = 0, duration = 4, extra: Record<string, unknown> = {}) => ({
  id,
  start,
  duration,
  sourceStart: 1,
  content: { media: { mediaID: "med" } },
  ...extra,
});
function setup(
  video: unknown[] = [clip("v")],
  audio: unknown[] = [clip("a")],
  extras: Record<string, unknown> = {},
) {
  return decodeProjectFile({
    revision: 0,
    project: {
      id: "prj_edit",
      media: [{ id: "med", path: "recording.webm", duration: 20, hasVideo: true, hasAudio: true }],
      videoTracks: [{ id: "picture", kind: "video", rippleMode: "cut", clips: video }],
      audioTracks: [{ id: "sound", kind: "audio", rippleMode: "cut", clips: audio }],
      ...extras,
    },
  });
}
describe("timeline editing", () => {
  it("replays deterministic split IDs and follows descendants in the same batch", () => {
    const initial = setup(),
      first = new ProjectCoordinator(initial),
      second = new ProjectCoordinator(initial);
    const commands = [{ blade: { at: 1, clipIDs: ["v"] } }, { blade: { at: 2, clipIDs: ["v"] } }];
    const a = first.apply({ commands }),
      b = second.apply({ commands });
    expect(a.createdIDs).toEqual(b.createdIDs);
    expect(a.createdIDs).toHaveLength(2);
    const clips = first.getSnapshot().project.videoTracks[0]!.clips;
    expect(clips.map((c) => [c.start.seconds, c.duration.seconds, c.sourceStart.seconds])).toEqual([
      [0, 1, 1],
      [1, 1, 2],
      [2, 2, 3],
    ]);
    expect(clips[0]?.id).toBe("v");
    first.undo();
    expect(encodeProjectFile({ ...first.getSnapshot(), revision: 0 })).toContain('"duration": 4');
    const context = new EditContext(0n, [], []);
    expect(context.makeID("clip")).toMatch(/^clip_[abcdefghijkmnpqrstuvwxyz23456789]{8}$/);
  });
  it("splits linked partners into paired groups and skips locked partners with warnings", () => {
    const value = new ProjectCoordinator(
      setup([clip("v", 0, 4, { linkGroup: "pair" })], [clip("a", 0, 4, { linkGroup: "pair" })]),
    );
    value.apply({ commands: [{ blade: { at: 2, clipIDs: ["v"] } }] });
    const p = value.getSnapshot().project;
    expect(p.videoTracks[0]?.clips[1]?.linkGroup).toBe(p.audioTracks[0]?.clips[1]?.linkGroup);
    expect(p.videoTracks[0]?.clips[1]?.linkGroup).not.toBe("pair");
    value.apply({ commands: [{ updateTrack: { trackID: "sound", patch: { locked: true } } }] });
    const result = value.apply({ commands: [{ blade: { at: 1, clipIDs: ["v"] } }] });
    expect(result.warnings.join(" ")).toMatch(/locked/);
    expect(value.getSnapshot().project.audioTracks[0]?.clips).toHaveLength(2);
  });
  it("shifts and prunes keyframes, retains outer fades, and clears inner fades on split", () => {
    const value = new ProjectCoordinator(
      setup(
        [
          clip("v", 0, 4, {
            audio: { fadeIn: 0.2, fadeOut: 0.3 },
            keyframes: {
              "video.opacity": [
                { time: 0, value: 0 },
                { time: 1, value: 1 },
                { time: 3, value: 0 },
                { time: 5, value: 1 },
              ],
            },
          }),
        ],
        [],
      ),
    );
    value.apply({ commands: [{ blade: { at: 2, clipIDs: ["v"] } }] });
    const [left, right] = value.getSnapshot().project.videoTracks[0]!.clips;
    expect(left?.audio).toMatchObject({ fadeIn: 0.2, fadeOut: 0 });
    expect(right?.audio).toMatchObject({ fadeIn: 0, fadeOut: 0.3 });
    expect(right?.keyframes["video.opacity"]?.map((k) => k.time)).toEqual([-1, 1, 3]);
  });
  it("trims linked edges by a shared delta and rejects invalid bounds atomically", () => {
    const value = new ProjectCoordinator(
      setup([clip("v", 0, 4, { linkGroup: "pair" })], [clip("a", 0.25, 4, { linkGroup: "pair" })]),
    );
    value.apply({ commands: [{ trim: { clipID: "v", edge: "start", to: 0.5 } }] });
    expect(value.getSnapshot().project.audioTracks[0]?.clips[0]?.start.seconds).toBe(0.75);
    expect(value.getSnapshot().project.videoTracks[0]?.clips[0]?.sourceStart.seconds).toBe(1.5);
    const before = value.getSnapshot();
    expect(() =>
      value.apply({
        commands: [
          { trim: { clipID: "v", edge: "end", to: 30 } },
          { trim: { clipID: "v", edge: "end", to: 2 } },
        ],
      }),
    ).toThrow(/past the end/);
    expect(value.getSnapshot()).toBe(before);
    expect(() =>
      value.apply({ commands: [{ trim: { clipID: "v", edge: "start", to: -2 } }] }),
    ).toThrow();
  });
  it("moves linked partners and leaves a gap when lifting, then unlink permits independent moves", () => {
    const value = new ProjectCoordinator(setup());
    value.apply({ commands: [{ link: { clipIDs: ["v", "a"] } }] });
    value.apply({ commands: [{ moveClips: { clipIDs: ["v"], delta: 1 } }] });
    expect(value.getSnapshot().project.audioTracks[0]?.clips[0]?.start.seconds).toBe(1);
    value.apply({
      commands: [{ unlink: { clipIDs: ["v"] } }, { moveClips: { clipIDs: ["v"], delta: 1 } }],
    });
    expect(value.getSnapshot().project.audioTracks[0]?.clips[0]?.start.seconds).toBe(1);
    expect(value.getSnapshot().project.audioTracks[0]?.clips[0]?.linkGroup).toBeNull();
    value.apply({ commands: [{ removeClips: { clipIDs: ["v"] } }] });
    expect(value.getSnapshot().project.videoTracks[0]?.clips).toEqual([]);
    expect(value.getSnapshot().project.audioTracks[0]?.clips[0]?.start.seconds).toBe(1);
    value.undo();
    expect(value.getSnapshot().project.videoTracks[0]?.clips).toHaveLength(1);
  });
  it("rejects overlapping moves and locked linked edits without changing any track", () => {
    const value = new ProjectCoordinator(
      setup([clip("v", 0, 1), clip("next", 2, 1)], [clip("a", 0, 1)]),
    );
    const before = value.getSnapshot();
    expect(() => value.apply({ commands: [{ moveClips: { clipIDs: ["v"], delta: 2 } }] })).toThrow(
      /overlap/,
    );
    expect(value.getSnapshot()).toBe(before);
    value.apply({
      commands: [
        { link: { clipIDs: ["v", "a"] } },
        { updateTrack: { trackID: "sound", patch: { locked: true } } },
      ],
    });
    const locked = value.getSnapshot();
    expect(() => value.apply({ commands: [{ removeClips: { clipIDs: ["v"] } }] })).toThrow(
      /locked/,
    );
    expect(value.getSnapshot()).toBe(locked);
  });
  it("cuts cut tracks, shortens follow tails, preserves off/locked tracks and maps markers", () => {
    const file = setup();
    const extra = [
      { id: "follow", kind: "video", rippleMode: "follow", clips: [clip("overlay", 0, 6)] },
      { id: "off", kind: "video", rippleMode: "off", clips: [clip("untouched", 4, 1)] },
      { id: "locked", kind: "video", rippleMode: "cut", locked: true, clips: [clip("held", 0, 6)] },
    ];
    const value = new ProjectCoordinator(
      setup([clip("v", 0, 6)], [clip("a", 0, 6)], {
        videoTracks: [
          ...file.project.videoTracks.map((t) => ({ ...t, clips: [clip("v", 0, 6)] })),
          ...extra,
        ],
        markers: [
          { id: "mark", time: 1, duration: 4 },
          { id: "later", time: 5, duration: 0 },
        ],
      }),
    );
    const result = value.apply({
      commands: [
        { rippleDeleteRange: { range: { start: 2, duration: 2 }, trackIDs: ["picture"] } },
      ],
    });
    const p = value.getSnapshot().project;
    expect(
      p.videoTracks[0]?.clips.map((c) => [
        c.start.seconds,
        c.duration.seconds,
        c.sourceStart.seconds,
      ]),
    ).toEqual([
      [0, 2, 1],
      [2, 2, 5],
    ]);
    expect(p.audioTracks[0]?.clips).toHaveLength(2);
    expect(p.videoTracks[1]?.clips[0]?.duration.seconds).toBe(4);
    expect(p.videoTracks[1]?.clips[0]?.sourceStart.seconds).toBe(1);
    expect(p.videoTracks[2]?.clips[0]?.start.seconds).toBe(4);
    expect(p.videoTracks[3]?.clips[0]?.duration.seconds).toBe(6);
    expect(result.warnings.join(" ")).toMatch(/Locked track/);
    expect(p.markers.map((m) => [m.time, m.duration])).toEqual([
      [1, 2],
      [3, 0],
    ]);
  });
  it("ripple-removes aligned linked selections and rejects misaligned cuts atomically", () => {
    const value = new ProjectCoordinator(
      setup(
        [clip("v", 0, 2, { linkGroup: "pair" }), clip("v2", 2, 2)],
        [clip("a", 0, 2, { linkGroup: "pair" }), clip("a2", 2, 2)],
      ),
    );
    value.apply({ commands: [{ removeClips: { clipIDs: ["v"], ripple: true } }] });
    expect(value.getSnapshot().project.videoTracks[0]?.clips[0]?.start.seconds).toBe(0);
    expect(value.getSnapshot().project.audioTracks[0]?.clips[0]?.start.seconds).toBe(0);
    const bad = new ProjectCoordinator(
      setup(
        [clip("v", 0, 2), clip("v2", 2, 2)],
        [clip("a", 0, 1), clip("a2", 1, 1), clip("a3", 2, 2)],
      ),
    );
    const before = bad.getSnapshot();
    expect(() =>
      bad.apply({
        commands: [{ removeClips: { clipIDs: ["v", "a"], ripple: true, includeLinked: false } }],
      }),
    ).toThrow(/line up/);
    expect(bad.getSnapshot()).toBe(before);
  });
  it("keeps a ripple local when only a follow track is explicitly cut", () => {
    const file = setup([clip("v", 0, 6)], [clip("a", 0, 6)]);
    const value = new ProjectCoordinator(
      decodeProjectFile({
        ...JSON.parse(encodeProjectFile(file)),
        project: {
          ...JSON.parse(encodeProjectFile(file)).project,
          videoTracks: [
            { id: "picture", kind: "video", rippleMode: "follow", clips: [clip("v", 0, 6)] },
          ],
          markers: [{ id: "mark", time: 5 }],
        },
      }),
    );
    value.apply({
      commands: [
        { rippleDeleteRange: { range: { start: 1, duration: 1 }, trackIDs: ["picture"] } },
      ],
    });
    expect(value.getSnapshot().project.audioTracks[0]?.clips[0]?.duration.seconds).toBe(6);
    expect(value.getSnapshot().project.markers[0]?.time).toBe(5);
  });
});
