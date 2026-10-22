import { describe, expect, it } from "vite-plus/test";
import { decodeProjectFile, encodeProjectFile, transitionTypes } from "@sidecut/contracts/project";
import { ProjectCoordinator } from "./coordinator";
import { framePlan, previewIssue, exportPlan, sourceTime } from "./render-plan";
import { transitionWindow, transitionProgress, directionVector } from "./transitions";
import { audioSegments } from "./audio-plan";
const clip = (id: string, start = 0, duration = 2, extra: Record<string, unknown> = {}) => ({
  id,
  start,
  duration,
  sourceStart: 0,
  content: { media: { mediaID: "m" } },
  ...extra,
});
const track = (id: string, clips: unknown[], extra: Record<string, unknown> = {}) => ({
  id,
  name: id,
  kind: "video",
  clips,
  ...extra,
});
const file = (video: unknown[], audio: unknown[] = []) =>
  decodeProjectFile({
    revision: 0,
    project: {
      id: "transitions",
      settings: { width: 64, height: 64 },
      media: [{ id: "m", path: "source.webm", duration: 2, hasVideo: true, hasAudio: true }],
      videoTracks: video,
      audioTracks: audio,
    },
  });
const apply = (c: ProjectCoordinator, command: unknown) => c.apply({ commands: [command] });
const transition = (extra: Record<string, unknown> = {}) => ({
  id: "tr",
  type: "dissolve",
  duration: 1,
  fromClipID: "left",
  toClipID: "right",
  ...extra,
});
const cuts = () => [track("v", [clip("left"), clip("right", 2, 2)])];
describe("transition commands", () => {
  it("keeps tied sound timing intact until sound lifecycle editing is available", () => {
    const c = new ProjectCoordinator(
      file(cuts(), [track("a", [clip("sound")], { kind: "audio" })]),
    );
    apply(c, { addTransition: { trackID: "v", transition: transition({ soundClipID: "sound" }) } });
    const before = c.getSnapshot();
    expect(() =>
      apply(c, { updateTransition: { transitionID: "tr", patch: { duration: 2 } } }),
    ).toThrow(/Untie/);
    expect(() => apply(c, { removeTransition: { transitionID: "tr" } })).toThrow(/Untie/);
    expect(c.getSnapshot()).toBe(before);
    apply(c, {
      updateTransition: { transitionID: "tr", patch: { soundClipID: null, duration: 2 } },
    });
    apply(c, { removeTransition: { transitionID: "tr" } });
    expect(c.getSnapshot().project.audioTracks[0]!.clips[0]!.id).toBe("sound");
  });
  it("creates stable IDs, warns about held source handles, and restores exact values on undo/redo", () => {
    const c = new ProjectCoordinator(file(cuts()));
    apply(c, { updateClip: { clipID: "left", patch: { sourceStart: 0 } } });
    const result = c.apply({
      label: "Dissolve cut",
      idempotencyKey: "transition",
      commands: [{ addTransition: { trackID: "v", transition: transition() } }],
    });
    expect(result.createdIDs).toEqual(["tr"]);
    expect(result.warnings).toHaveLength(2);
    expect(c.apply({ idempotencyKey: "transition", commands: [] })).toBe(result);
    const p = encodeProjectFile({ revision: 0, project: c.getSnapshot().project });
    c.undo();
    expect(c.getSnapshot().project.videoTracks[0]!.transitions).toHaveLength(0);
    c.redo();
    expect(encodeProjectFile({ revision: 0, project: c.getSnapshot().project })).toBe(p);
    apply(c, {
      updateTransition: {
        transitionID: "tr",
        patch: { duration: 2, type: "wipe", direction: "up" },
      },
    });
    expect(c.getSnapshot().project.videoTracks[0]!.transitions[0]).toMatchObject({
      duration: 2,
      type: "wipe",
      direction: "up",
    });
    apply(c, { removeTransition: { transitionID: "tr" } });
    expect(c.getSnapshot().project.videoTracks[0]!.transitions).toHaveLength(0);
  });
  it("validates heads/tails, touched clips, durations, IDs and directions atomically", () => {
    for (const value of [
      transition({ duration: 0 }),
      transition({ duration: -1 }),
      transition({ duration: 5 }),
      transition({ fromClipID: null, toClipID: null }),
      transition({ toClipID: "absent" }),
      transition({ type: "unknown" }),
      transition({ direction: "diagonal" }),
      transition({ id: "m" }),
      transition({ duration: NaN }),
    ]) {
      const c = new ProjectCoordinator(file(cuts())),
        before = c.getSnapshot();
      expect(() => apply(c, { addTransition: { trackID: "v", transition: value } })).toThrow();
      expect(c.getSnapshot()).toBe(before);
    }
    const c = new ProjectCoordinator(file(cuts()));
    apply(c, { addTransition: { trackID: "v", transition: transition() } });
    expect(() =>
      apply(c, { addTransition: { trackID: "v", transition: transition({ id: "other" }) } }),
    ).toThrow(/already/);
    const before = c.getSnapshot();
    for (const patch of [
      { id: "new" },
      { duration: null },
      { duration: 8 },
      { direction: "bad" },
    ]) {
      expect(() => apply(c, { updateTransition: { transitionID: "tr", patch } })).toThrow();
      expect(c.getSnapshot()).toBe(before);
    }
    apply(c, { updateTrack: { trackID: "v", patch: { locked: true } } });
    expect(() => apply(c, { removeTransition: { transitionID: "tr" } })).toThrow(/locked/);
  });
  it("accepts head/tail types and refuses gap cuts and overlong single edges", () => {
    const c = new ProjectCoordinator(file(cuts()));
    apply(c, {
      addTransition: {
        trackID: "v",
        transition: transition({ fromClipID: null, toClipID: "left", duration: 2 }),
      },
    });
    expect(
      transitionWindow(
        c.getSnapshot().project.videoTracks[0]!,
        c.getSnapshot().project.videoTracks[0]!.transitions[0]!,
      ),
    ).toEqual({ start: 0, end: 2, duration: 2 });
    apply(c, {
      updateTransition: { transitionID: "tr", patch: { fromClipID: "right", toClipID: null } },
    });
    expect(
      transitionWindow(
        c.getSnapshot().project.videoTracks[0]!,
        c.getSnapshot().project.videoTracks[0]!.transitions[0]!,
      ),
    ).toEqual({ start: 2, end: 4, duration: 2 });
    expect(() =>
      apply(c, { updateTransition: { transitionID: "tr", patch: { duration: 2.1 } } }),
    ).toThrow(/longer/);
    const gap = new ProjectCoordinator(file([track("v", [clip("left"), clip("right", 3)])]));
    expect(() => apply(gap, { addTransition: { trackID: "v", transition: transition() } })).toThrow(
      /meet/,
    );
  });
  it("decodes all eight types and produces deterministic missing transition IDs", () => {
    for (const type of transitionTypes) {
      const a = new ProjectCoordinator(file(cuts())),
        b = new ProjectCoordinator(file(cuts()));
      const command = {
        addTransition: {
          trackID: "v",
          transition: { type, duration: 1, fromClipID: "left", toClipID: "right" },
        },
      };
      expect(apply(a, command).createdIDs).toEqual(apply(b, command).createdIDs);
    }
  });
});
describe("shared picture transition plan", () => {
  it("extends both pictures through centered handles and keeps source mapping beyond the clip edge", () => {
    const c = new ProjectCoordinator(file(cuts()));
    apply(c, { addTransition: { trackID: "v", transition: transition() } });
    const p = c.getSnapshot().project;
    const plan = framePlan(p, 1.75);
    expect(plan.layers.map((l) => [l.clip.id, l.sourceTime])).toEqual([
      ["left", 1.75],
      ["right", 0],
    ]);
    expect(plan.nodes[0]).toMatchObject({ kind: "transition", start: 1.5, end: 2.5 });
    expect(sourceTime(plan.layers[1]!.clip, 1.75)).toBe(-0.25);
    expect(framePlan(p, 2.25).layers[0]!.sourceTime).toBeCloseTo(1.999999, 6);
    expect(framePlan(p, 2.5).layers.map((l) => l.clip.id)).toEqual(["right"]);
    expect(previewIssue(p, 2)).toBeNull();
    expect(exportPlan(p).duration).toBe(4);
  });
  it("folds overlapping windows into nested nodes without drawing a clip twice", () => {
    const p = file([
      track("v", [clip("left", 0, 1), clip("middle", 1, 1), clip("right", 2, 1)], {
        transitions: [
          transition({ id: "first", duration: 2, toClipID: "middle" }),
          transition({ id: "second", duration: 2, fromClipID: "middle" }),
        ],
      }),
    ]).project;
    const plan = framePlan(p, 1.5);
    expect(plan.nodes).toHaveLength(1);
    expect(plan.nodes[0]).toMatchObject({
      kind: "transition",
      transition: { id: "second" },
      from: { kind: "transition", transition: { id: "first" } },
    });
    expect(plan.layers.map((l) => l.clip.id)).toEqual(["left", "middle", "right"]);
  });
  it("does not revive a disabled incoming clip, and retains underlying track order", () => {
    const p = file([
      track("base", [clip("bottom", 0, 5)]),
      track("v", [clip("left"), clip("right", 2, 2, { enabled: false })], {
        transitions: [transition()],
      }),
    ]).project;
    const plan = framePlan(p, 2);
    expect(plan.nodes[1]).toMatchObject({ kind: "transition", to: null });
    expect(plan.layers.map((l) => l.clip.id)).toEqual(["bottom", "left"]);
  });
  it("retains adjustment clips in stack order and resolves their effects and opacity", () => {
    const p = file([
      track("base", [clip("bottom")]),
      track("grade", [
        clip("grade", 0, 2, {
          content: { adjustment: {} },
          video: {
            effects: [{ id: "fx", type: "colorAdjust", params: { exposure: 1 } }],
            opacity: 0.5,
          },
        }),
      ]),
      track("top", [clip("top")]),
    ]).project;
    expect(framePlan(p, 1).layers.map((l) => l.clip.id)).toEqual(["bottom", "grade", "top"]);
    expect(previewIssue(p, 1)).toBeNull();
  });
  it("uses the reference cubic/quartic easing and default motion direction", () => {
    expect(transitionProgress("dissolve", 0.25)).toBe(0.25);
    expect(transitionProgress("push", 0.25)).toBe(0.0625);
    expect(transitionProgress("cutSlide", 0.25)).toBe(0.03125);
    expect(transitionProgress("zoom", 2)).toBe(1);
    expect(directionVector(null)).toEqual([-1, 0]);
  });
});
describe("raw timeline audio plan", () => {
  it("schedules overlapping tracks with independent source offsets and excludes frozen/muted/disabled clips", () => {
    const p = file(
      [],
      [
        track(
          "a",
          [clip("one", 0, 1, { sourceStart: 1 }), clip("disabled", 1, 1, { enabled: false })],
          { kind: "audio" },
        ),
        track(
          "b",
          [
            clip("two", 0.25, 1, { sourceStart: 0.5 }),
            clip("freeze", 1.25, 1, { freezeFrame: true }),
          ],
          { kind: "audio" },
        ),
        track("muted", [clip("ignored")], { kind: "audio", muted: true }),
      ],
    ).project;
    expect(audioSegments(p).map((a) => [a.clip.id, a.start, a.end, a.sourceStart])).toEqual([
      ["one", 0, 1, 1],
      ["two", 0.25, 1.25, 0.5],
    ]);
    expect(framePlan(p, 0.5).audio).toHaveLength(2);
    expect(exportPlan(p).hasAudio).toBe(true);
  });
  it("a muted solo track does not silence the other tracks and held edges leave real gaps", () => {
    const p = file(
      [],
      [
        track("a", [clip("one", 0, 4, { sourceStart: -1, holdEdges: true })], { kind: "audio" }),
        track("b", [clip("ignored")], { kind: "audio", muted: true, solo: true }),
      ],
    ).project;
    expect(audioSegments(p).map((a) => [a.start, a.end, a.sourceStart, a.sourceEnd])).toEqual([
      [1, 3, 0, 2],
    ]);
    expect(framePlan(p, 0.5).audio).toHaveLength(0);
    expect(framePlan(p, 3.5).audio).toHaveLength(0);
  });
});
