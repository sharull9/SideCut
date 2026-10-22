import { describe, expect, it } from "vite-plus/test";
import { decodeProjectFile, encodeProjectFile } from "@sidecut/contracts/project";
import { ProjectCoordinator, replayJournal } from "./coordinator";
import { framePlan, layerGeometry, previewIssue, exportPlan } from "./render-plan";

function fixture() {
  return decodeProjectFile({
    revision: 0,
    project: {
      id: "angles",
      settings: { width: 1920, height: 1080 },
      media: [
        {
          id: "camera",
          path: "camera.webm",
          role: "camera",
          takeID: "take",
          duration: 12,
          hasAudio: true,
        },
        { id: "angle", path: "angle.webm", takeID: "take", takeOffset: 2, duration: 8 },
      ],
      videoTracks: [
        {
          id: "base",
          kind: "video",
          clips: [
            {
              id: "cam",
              content: { media: { mediaID: "camera" } },
              duration: 12,
              linkGroup: "link",
            },
          ],
        },
        {
          id: "other",
          kind: "video",
          clips: [
            {
              id: "ang",
              content: { media: { mediaID: "angle" } },
              start: 2,
              duration: 8,
              enabled: false,
              linkGroup: "link",
            },
          ],
        },
      ],
      audioTracks: [
        {
          id: "voice",
          kind: "audio",
          clips: [
            {
              id: "mic",
              content: { media: { mediaID: "camera" } },
              duration: 12,
              linkGroup: "link",
            },
          ],
        },
      ],
    },
  });
}
const angle = { showAngle: { range: { start: 3, duration: 3 }, trackID: "other" } };
describe("angle selection", () => {
  it("switches a range with source-synchronized linked sound, then returns to the camera and undoes", () => {
    const c = new ProjectCoordinator(fixture());
    c.apply({ commands: [angle] });
    const p = c.getSnapshot().project;
    expect(framePlan(p, 2.9).layers.map((l) => l.trackID)).toEqual(["base"]);
    expect(framePlan(p, 3).layers.map((l) => l.trackID)).toEqual(["base", "other"]);
    expect(framePlan(p, 6).layers.map((l) => l.trackID)).toEqual(["base"]);
    expect(framePlan(p, 4).layers[1]?.sourceTime).toBe(2);
    expect(framePlan(p, 4).audio).toHaveLength(1);
    expect(framePlan(p, 4).audio[0]?.sourceTime).toBe(4);
    expect(framePlan(p, 4).audio[0]?.clip.linkGroup).toBe(
      framePlan(p, 4).layers[1]?.clip.linkGroup,
    );
    c.apply({ commands: [{ showAngle: { range: { start: 3, duration: 3 }, trackID: "base" } }] });
    expect(framePlan(c.getSnapshot().project, 4).layers).toHaveLength(1);
    c.undo();
    expect(framePlan(c.getSnapshot().project, 4).layers).toHaveLength(2);
  });
  it("warns for partial coverage, rounds edges, and rejects invalid or locked takes atomically", () => {
    const c = new ProjectCoordinator(fixture());
    expect(
      c.apply({
        commands: [{ showAngle: { trackID: "other", range: { start: 0, duration: 12 } } }],
      }).warnings[0],
    ).toMatch(/camera shows/);
    const locked = fixture();
    const c2 = new ProjectCoordinator({
      ...locked,
      project: {
        ...locked.project,
        videoTracks: locked.project.videoTracks.map((t) =>
          t.id === "other" ? { ...t, locked: true } : t,
        ),
      },
    });
    expect(() => c2.apply({ commands: [angle] })).toThrow(/locked/);
    expect(c2.getSnapshot().revision).toBe(0);
    const lockedVoice = new ProjectCoordinator({
      ...locked,
      project: {
        ...locked.project,
        audioTracks: locked.project.audioTracks.map((t) => ({ ...t, locked: true })),
      },
    });
    expect(lockedVoice.apply({ commands: [angle] }).warnings.join(" ")).toMatch(/locked/);
    expect(lockedVoice.getSnapshot().project.audioTracks[0]?.clips).toHaveLength(1);
    expect(() =>
      c.apply({
        commands: [{ showAngle: { trackID: "voice", range: { start: 3, duration: 3 } } }],
      }),
    ).toThrow(/picture/);
    expect(() =>
      c.apply({
        commands: [{ showAngle: { trackID: "other", range: { start: 3, duration: 0.001 } } }],
      }),
    ).toThrow(/frame/);
  });
});
describe("durable edit journal", () => {
  it("replays deterministic generated IDs, authors, undo/redo snapshots and retries after reopen", () => {
    const c = new ProjectCoordinator(fixture());
    const batch = {
      author: "agent",
      label: "Switch angle",
      idempotencyKey: "switch",
      commands: [angle],
    };
    const result = c.apply(batch);
    c.undo();
    c.redo();
    expect(Object.isFrozen(c.projectFile().sidecutJournal)).toBe(true);
    const saved = decodeProjectFile(JSON.parse(encodeProjectFile(c.projectFile())));
    expect(replayJournal(saved)).toEqual(saved);
    const reopened = new ProjectCoordinator(saved);
    expect(reopened.apply(batch)).toEqual(result);
    expect(reopened.getSnapshot().revision).toBe(3);
    expect(reopened.projectFile()).toEqual(saved);
  });
  it("rejects missing entries, forged result data and a mismatched snapshot", () => {
    const c = new ProjectCoordinator(fixture());
    c.apply({ commands: [angle] });
    const raw = JSON.parse(encodeProjectFile(c.projectFile()));
    raw.sidecutJournal.entries[0].result.createdIDs = ["wrong"];
    expect(() => replayJournal(decodeProjectFile(raw))).toThrow(/result/);
    const missing = JSON.parse(encodeProjectFile(c.projectFile()));
    missing.sidecutJournal.entries = [];
    expect(() => replayJournal(decodeProjectFile(missing))).toThrow(/snapshot/);
    const mismatch = JSON.parse(encodeProjectFile(c.projectFile()));
    mismatch.project.name = "Tampered";
    expect(() => replayJournal(decodeProjectFile(mismatch))).toThrow(/snapshot/);
  });
});
describe("shared picture plan", () => {
  it("orders layers bottom to top and respects hidden, solo, enabled, gaps and half-open cuts", () => {
    const c = new ProjectCoordinator(fixture());
    c.apply({ commands: [angle] });
    const p = c.getSnapshot().project;
    expect(framePlan(p, 3).layers.map((l) => l.clip.id)).toHaveLength(2);
    expect(framePlan(p, 12).layers).toEqual([]);
    expect(
      framePlan(
        {
          ...p,
          videoTracks: p.videoTracks.map((t) => (t.id === "other" ? { ...t, hidden: true } : t)),
        },
        4,
      ).layers,
    ).toHaveLength(1);
    expect(
      framePlan(
        {
          ...p,
          videoTracks: p.videoTracks.map((t) => (t.id === "other" ? { ...t, solo: true } : t)),
        },
        4,
      ).layers.map((l) => l.trackID),
    ).toEqual(["other"]);
    expect(exportPlan(p).duration).toBe(12);
  });
  it("fits an image, positions a half-size PiP, and rotates clockwise in canvas coordinates", () => {
    const clip = fixture().project.videoTracks[0]!.clips[0]!;
    expect(layerGeometry(clip, 1920, 1080, 1000, 1000)).toEqual({
      x: 960,
      y: 540,
      width: 1080,
      height: 1080,
      radians: 0,
    });
    const pip = {
      ...clip,
      video: { transform: { position: { x: 0.75, y: 0.75 }, scale: 0.5, rotation: 90 } },
    };
    expect(layerGeometry(pip, 1920, 1080, 1920, 1080)).toEqual({
      x: 1440,
      y: 810,
      width: 960,
      height: 540,
      radians: Math.PI / 2,
    });
    expect(
      layerGeometry({ ...clip, video: { transform: { scale: -1 } } }, 1920, 1080, 1920, 1080),
    ).toMatchObject({ width: 1920, height: 1080, radians: Math.PI });
    const p = {
      ...fixture().project,
      videoTracks: [{ ...fixture().project.videoTracks[0]!, clips: [pip] }],
    };
    expect(previewIssue(p, 1)).toBeNull();
    expect(
      previewIssue(
        {
          ...p,
          videoTracks: [
            {
              ...p.videoTracks[0]!,
              clips: [
                {
                  ...pip,
                  video: { ...pip.video, effects: [{ id: "fx", type: "unknown", params: {} }] },
                },
              ],
            },
          ],
        },
        1,
      ),
    ).toMatch(/rendering features/);
  });
});
