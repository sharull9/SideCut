import { describe, it, expect } from "vite-plus/test";
import { decodeProjectFile, encodeProjectFile } from "@sidecut/contracts/project";
import { ProjectCoordinator } from "./coordinator";
import { queryClips } from "./project-queries";
import { clipChanges, diffEdits, restorePlan, wireFile } from "./service-edits";
import { helperPlan } from "./service-speech";

const fixture = () =>
  decodeProjectFile({
    revision: 0,
    project: {
      id: "matrix",
      media: [
        { id: "m", path: "one/take.wav", kind: "audio", hasAudio: true, duration: 20 },
        { id: "other", path: "two/take.wav", kind: "audio", hasAudio: true, duration: 20 },
      ],
      videoTracks: [
        {
          id: "bottom",
          name: "Camera",
          kind: "video",
          clips: [
            { id: "solid", duration: 1, content: { solid: { color: { r: 0, g: 0, b: 0, a: 1 } } } },
          ],
        },
        { id: "top", name: "Overlay", kind: "video", clips: [] },
      ],
      audioTracks: [
        {
          id: "voice",
          name: "Voice",
          kind: "audio",
          clips: [
            { id: "a", duration: 2, content: { media: { mediaID: "m" } }, linkGroup: "l" },
            {
              id: "b",
              start: 2,
              sourceStart: 2,
              duration: 2,
              content: { media: { mediaID: "m" } },
              linkGroup: "r",
            },
            {
              id: "c",
              start: 4,
              sourceStart: 4,
              duration: 2,
              content: { media: { mediaID: "m" } },
            },
          ],
        },
        {
          id: "music",
          name: "Music",
          kind: "audio",
          clips: [
            { id: "x", duration: 2, content: { media: { mediaID: "other" } }, linkGroup: "l" },
            {
              id: "y",
              start: 2,
              sourceStart: 2,
              duration: 2,
              content: { media: { mediaID: "other" } },
              linkGroup: "r",
            },
          ],
        },
      ],
    },
  });
describe("120.04, 121.05-06 and 123.01 pinned query/history/helper cases", () => {
  it("lists tracks top down and supports IDs, names, labels, media aliases and half-open ranges", () => {
    const file = fixture(),
      before = encodeProjectFile(file);
    expect(queryClips(file, {}).clips.map((c) => c.id)).toEqual(["solid", "a", "b", "c", "x", "y"]);
    for (const track of ["voice", "Voice", "A1", "A1 Voice"])
      expect(queryClips(file, { track, from: 2, to: 4, ids: true })).toMatchObject({
        revision: 0,
        idsOnly: true,
        clips: [
          {
            id: "b",
            track: "A1 Voice",
            trackID: "voice",
            start: 2,
            end: 4,
            duration: 2,
            enabled: true,
          },
        ],
      });
    for (const media of ["m", "one/take.wav"])
      expect(queryClips(file, { media }).clips.map((c) => c.id)).toEqual(["a", "b", "c"]);
    expect(queryClips(file, { media: "TAKE.WAV" }).clips).toHaveLength(5);
    expect(queryClips(file, { from: 10 }).clips).toEqual([]);
    expect(() => queryClips(file, { track: "missing" })).toThrow(/no track/);
    expect(() => queryClips(file, { media: "missing" })).toThrow(/No media/);
    expect(() => queryClips(file, { from: "bad" })).toThrow(/Time/);
    expect(encodeProjectFile(file)).toBe(before);
  });
  it("describes shifts, trims, properties, cuts and individual edit/undo/redo records", () => {
    const file = fixture(),
      session = new ProjectCoordinator(file);
    session.apply({
      label: "Move",
      author: "agent",
      commands: [{ updateClip: { clipID: "c", patch: { start: 7 } } }],
    });
    expect(clipChanges(file, session.projectFile())).toMatchObject([
      { id: "c", details: ["moved +3.000s"], shift: 3, wasStart: 4, wasEnd: 6 },
    ]);
    session.apply({
      label: "Gain",
      commands: [
        {
          updateClip: {
            clipID: "c",
            patch: { audio: { gainDB: -6 }, name: "Renamed", enabled: false },
          },
        },
      ],
    });
    expect(clipChanges(file, session.projectFile())[0]!.details).toEqual([
      "moved +3.000s",
      "turned off",
      'name none -> "Renamed"',
      "gain 0 -> -6 dB",
    ]);
    expect(clipChanges(file, session.projectFile())[0]!.shift).toBeUndefined();
    session.undo();
    session.redo();
    expect(
      diffEdits(session.projectFile(), 0)?.map((e) => [
        e.revision,
        e.kind,
        e.label,
        e.changes.length,
      ]),
    ).toEqual([
      [1, "edit", "Move", 1],
      [2, "edit", "Gain", 1],
      [3, "undo", "Undo Gain", 1],
      [4, "redo", "Redo Gain", 1],
    ]);
    expect(diffEdits(session.projectFile(), 4)).toEqual([]);
    const cut = new ProjectCoordinator(file);
    cut.apply({ commands: [{ blade: { clipIDs: ["c"], at: 5 } }] });
    const changes = clipChanges(file, cut.projectFile());
    expect(changes.find((c) => c.kind === "added")?.details[0]).toBe("the rest of c after a cut");
    expect(diffEdits(cut.projectFile(), 0)?.[0]).toMatchObject({
      start: 5,
      end: 5,
      tracks: ["A1 Voice"],
    });
    const trim = new ProjectCoordinator(file);
    trim.apply({
      commands: [{ updateClip: { clipID: "c", patch: { duration: 1.5, sourceStart: 4.5 } } }],
    });
    expect(clipChanges(file, trim.projectFile())[0]?.details).toEqual([
      "start trimmed +0.500s, rippled",
    ]);
    expect(diffEdits(trim.projectFile(), 0)?.[0]).toMatchObject({ start: 4, end: 4.5 });
  });
  it("restores only baseline-range clips and newly added clips, preserving unrelated moved clips", () => {
    const file = fixture(),
      session = new ProjectCoordinator(file);
    session.apply({
      commands: [
        { updateClip: { clipID: "c", patch: { start: 10 } } },
        { updateClip: { clipID: "a", patch: { start: 6 } } },
      ],
    });
    const plan = restorePlan(session.projectFile(), file, {
      fromTime: 4,
      toTime: 8,
      track: "voice",
    });
    expect(plan.items.map((i) => i.id)).toEqual(["c"]);
    session.apply({ commands: plan.commands });
    expect(
      queryClips(session.projectFile(), { track: "voice" }).clips.map((c) => [c.id, c.start]),
    ).toContainEqual(["a", 6]);
    session.undo();
    expect(queryClips(session.projectFile(), { from: 10 }).clips[0]?.id).toBe("c");
    expect(() => restorePlan(session.projectFile(), file, { clips: ["absent"] })).toThrow(
      /does not exist/,
    );
  });
  it("reports each linked pair and the surviving ID at consecutive cuts, with full skipped reasons", () => {
    const file = fixture(),
      session = new ProjectCoordinator(file);
    const plan = helperPlan(file, "join", { from: 2, to: 2 }, () => undefined);
    expect(helperPlan(file, "join", { from: 100 }, () => undefined).commands).toEqual([]);
    expect(plan).toMatchObject({
      joins: [
        {
          time: 2,
          clips: [
            { track: "A1 Voice", clipID: "a", nextClipID: "b" },
            { track: "A2 Music", clipID: "x", nextClipID: "y" },
          ],
        },
      ],
      skipped: [],
    });
    session.apply({ commands: plan.commands });
    session.undo();
    expect(encodeProjectFile({ revision: 0, project: session.getSnapshot().project })).toBe(
      encodeProjectFile(file),
    );
    const unlinked = decodeProjectFile(JSON.parse(encodeProjectFile(file)));
    const single = new ProjectCoordinator(unlinked);
    single.apply({ commands: [{ updateClip: { clipID: "c", patch: { audio: { gainDB: -3 } } } }] });
    const skipped = helperPlan(single.projectFile(), "join", {}, () => undefined);
    expect(skipped).toMatchObject({
      skipped: [
        {
          time: 4,
          trackID: "voice",
          clipID: "a",
          nextClipID: "c",
          reason: expect.stringContaining("Linked"),
        },
      ],
    });
  });
  it("restores onto replacement tracks and reports placement conflicts without changing the project", () => {
    const source = fixture(),
      raw = wireFile(source);
    const current = decodeProjectFile({
      ...raw,
      project: {
        ...raw.project,
        audioTracks: raw.project.audioTracks?.map((t) =>
          t.id === "voice" ? { ...t, id: "replacement", clips: [] } : t,
        ),
      },
    });
    const plan = restorePlan(current, source, { clips: ["a"] });
    expect(plan.problem).toBeUndefined();
    expect(plan.commands).toContainEqual(
      expect.objectContaining({ insertClip: expect.objectContaining({ trackID: "replacement" }) }),
    );
    const restored = new ProjectCoordinator(current);
    restored.apply({ commands: plan.commands });
    expect(queryClips(restored.projectFile(), { track: "replacement" }).clips[0]?.id).toBe("a");
    const conflict = new ProjectCoordinator(source);
    conflict.apply({
      commands: [
        { updateClip: { clipID: "c", patch: { start: 10 } } },
        { updateClip: { clipID: "a", patch: { start: 4 } } },
      ],
    });
    const before = encodeProjectFile(conflict.projectFile()),
      invalid = restorePlan(conflict.projectFile(), source, { clips: ["c"] });
    expect(invalid.problem).toMatch(/overlap/);
    expect(() => conflict.apply({ commands: invalid.commands })).toThrow(/overlap/);
    expect(encodeProjectFile(conflict.projectFile())).toBe(before);
  });
  it("retains all refused cuts and uses the original surviving ID for chained joins", () => {
    const file = decodeProjectFile({
      revision: 0,
      project: {
        id: "chain",
        media: [{ id: "m", path: "voice.wav", kind: "audio", duration: 20 }],
        audioTracks: [
          {
            id: "v",
            kind: "audio",
            clips: Array.from({ length: 6 }, (_, i) => ({
              id: `c${i}`,
              start: i,
              sourceStart: i,
              duration: 1,
              content: { media: { mediaID: "m" } },
            })),
          },
        ],
      },
    });
    const plan = helperPlan(file, "join", {}, () => undefined);
    if (!("joins" in plan) || !plan.joins) throw new Error("Expected join report.");
    expect(plan.joins.map((j) => j.clips.map((c) => [c.clipID, c.nextClipID]))).toEqual(
      Array.from({ length: 5 }, (_, i) => [["c0", `c${i + 1}`]]),
    );
    const session = new ProjectCoordinator(file);
    session.apply({
      commands: [1, 3, 5].map((i) => ({
        updateClip: { clipID: `c${i}`, patch: { audio: { gainDB: -3 } } },
      })),
    });
    const refused = helperPlan(session.projectFile(), "join", {}, () => undefined);
    if (!("skipped" in refused) || !refused.skipped) throw new Error("Expected skipped report.");
    expect(refused.skipped).toHaveLength(5);
    expect(
      refused.skipped.every((s) => s.reason === "The clips have different playback settings."),
    ).toBe(true);
    expect(refused.commands).toEqual([]);
  });
});
