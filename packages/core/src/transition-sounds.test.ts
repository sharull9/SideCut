import { describe, it, expect } from "vite-plus/test";
import { decodeProjectFile } from "@sidecut/contracts/project";
import { ProjectCoordinator, replayJournal } from "./coordinator";
const fixture = () =>
  decodeProjectFile({
    revision: 0,
    project: {
      id: "sounds",
      media: [
        {
          id: "m",
          path: "beep.wav",
          kind: "audio",
          duration: 1,
          attribution: "Synthetic SideCut fixture",
        },
      ],
      videoTracks: [
        {
          id: "v",
          kind: "video",
          clips: [
            { id: "left", duration: 3, content: { solid: {} } },
            { id: "right", start: 3, duration: 3, content: { solid: {} } },
          ],
        },
      ],
      audioTracks: [],
    },
  });
const add = {
  addTransition: {
    trackID: "v",
    transition: { id: "tr", type: "push", duration: 1, fromClipID: "left", toClipID: "right" },
    sound: { mediaID: "m", gainDB: -15, offset: -0.25 },
  },
};
const sound = (c: ProjectCoordinator) =>
  c.getSnapshot().project.audioTracks.flatMap((t) => t.clips)[0]!;
const apply = (c: ProjectCoordinator, command: unknown) => c.apply({ commands: [command] });
describe("transition sound lifecycle", () => {
  it("preserves its midpoint offset through ripple deletion and removes it with its cut", () => {
    const c = new ProjectCoordinator(fixture());
    apply(c, add);
    const id = sound(c).id;
    apply(c, { rippleDeleteRange: { range: { start: 1, duration: 0.5 }, trackIDs: ["v"] } });
    expect(sound(c).id).toBe(id);
    expect(sound(c).start.seconds).toBe(2.25);
    const before = c.getSnapshot().project;
    apply(c, { removeClips: { clipIDs: ["right"], ripple: true, includeLinked: false } });
    expect(c.getSnapshot().project.audioTracks.flatMap((t) => t.clips)).toEqual([]);
    c.undo();
    expect(c.getSnapshot().project).toEqual(before);
    expect(replayJournal(c.projectFile()).project).toEqual(before);
  });
  it("creates ordinary SFX, carries it through a roll, and deletes it with the transition", () => {
    const c = new ProjectCoordinator(fixture());
    const result = apply(c, add);
    expect(sound(c)).toMatchObject({ audio: { gainDB: -15 } });
    expect(sound(c).start.seconds).toBe(2.75);
    expect(result.createdIDs).toContain(sound(c).id);
    apply(c, { roll: { leftClipID: "left", rightClipID: "right", delta: 0.5 } });
    expect(sound(c).start.seconds).toBe(3.25);
    const before = c.getSnapshot().project;
    apply(c, { removeTransition: { transitionID: "tr" } });
    expect(c.getSnapshot().project.audioTracks.flatMap((t) => t.clips)).toEqual([]);
    c.undo();
    expect(c.getSnapshot().project).toEqual(before);
    expect(replayJournal(c.projectFile()).project).toEqual(before);
  });
  it("preserves a detach and honors edits explicitly naming the sound", () => {
    const c = new ProjectCoordinator(fixture());
    apply(c, add);
    const id = sound(c).id;
    apply(c, { updateClip: { clipID: id, patch: { start: 1.5, audio: { gainDB: -8 } } } });
    apply(c, { updateTransition: { transitionID: "tr", patch: { soundClipID: null } } });
    apply(c, { removeTransition: { transitionID: "tr" } });
    expect(sound(c).start.seconds).toBe(1.5);
    expect(sound(c).audio?.gainDB).toBe(-8);
  });
  it("unties an explicitly deleted sound, and sound:null removes the clip", () => {
    const c = new ProjectCoordinator(fixture());
    apply(c, add);
    apply(c, { removeClips: { clipIDs: [sound(c).id], ripple: false, includeLinked: false } });
    expect(c.getSnapshot().project.videoTracks[0]!.transitions[0]!.soundClipID).toBeNull();
    apply(c, { updateTransition: { transitionID: "tr", patch: { sound: { mediaID: "m" } } } });
    apply(c, { updateTransition: { transitionID: "tr", patch: { sound: null } } });
    expect(c.getSnapshot().project.audioTracks.flatMap((t) => t.clips)).toHaveLength(0);
  });
  it("patches timing atomically, trims negative starts, and preserves locked sound tracks", () => {
    const c = new ProjectCoordinator(fixture());
    apply(c, add);
    apply(c, { updateTransition: { transitionID: "tr", patch: { sound: { offset: -3.25 } } } });
    expect(sound(c).start.seconds).toBe(0);
    expect(sound(c).sourceStart.seconds).toBe(0.25);
    expect(sound(c).duration.seconds).toBe(0.75);
    const trackID = c.getSnapshot().project.audioTracks[0]!.id;
    apply(c, { updateTrack: { trackID, patch: { locked: true } } });
    const before = c.getSnapshot();
    expect(() =>
      apply(c, { updateTransition: { transitionID: "tr", patch: { sound: null } } }),
    ).toThrow(/locked/);
    expect(c.getSnapshot()).toBe(before);
    expect(apply(c, { removeTransition: { transitionID: "tr" } }).warnings.join(" ")).toMatch(
      /locked/,
    );
    expect(sound(c).start.seconds).toBe(0);
  });
  it("rejects malformed sound patches without partial transitions or clips", () => {
    for (const patch of [
      { mediaID: "missing" },
      { mediaID: "m", offset: -10 },
      { mediaID: "m", gainDB: "loud" },
      { mediaID: "m", unexpected: 1 },
    ]) {
      const c = new ProjectCoordinator(fixture()),
        before = c.getSnapshot();
      expect(() =>
        apply(c, { ...add, addTransition: { ...add.addTransition, sound: patch } }),
      ).toThrow();
      expect(c.getSnapshot()).toBe(before);
    }
  });
});
