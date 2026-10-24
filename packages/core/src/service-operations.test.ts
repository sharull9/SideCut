import { describe, it, expect } from "vite-plus/test";
import { decodeProjectFile, encodeProjectFile } from "@sidecut/contracts/project";
import { ProjectCoordinator, replayJournal } from "./coordinator";
import { serviceRequest, inspectionTimes } from "./service-requests";
import { revisionFile, clipChanges, restorePlan } from "./service-edits";
import { speechQuery, helperPlan } from "./service-speech";
import contracts from "../../../tests/fixtures/tandem/service-operations.json";
const fixture = () =>
  decodeProjectFile({
    revision: 0,
    project: {
      id: "prj_service",
      name: "Service fixture",
      media: [{ id: "med_voice", path: "voice.wav", kind: "audio", hasAudio: true, duration: 10 }],
      videoTracks: [{ id: "video", kind: "video", name: "Graphics" }],
      audioTracks: [
        {
          id: "voice",
          kind: "audio",
          name: "Voice",
          rippleMode: "cut",
          clips: [{ id: "speech", content: { media: { mediaID: "med_voice" } }, duration: 4 }],
        },
      ],
      markers: [{ id: "section", name: "Next", kind: "section", time: 2 }],
    },
  });
const transcript = {
  model: "fixture",
  language: "en",
  words: [
    { text: "Hello.", start: 0, end: 0.3 },
    { text: "New", start: 1.5, end: 1.8 },
    { text: "world.", start: 2, end: 2.3 },
  ],
};
describe("service operations", () => {
  it("restores properties without deleting an existing transition", () => {
    const file = decodeProjectFile({
      revision: 0,
      project: {
        id: "prj_transition_restore",
        media: [{ id: "m", path: "voice.wav", kind: "audio", duration: 10 }],
        audioTracks: [
          {
            id: "a",
            kind: "audio",
            clips: [
              { id: "left", content: { media: { mediaID: "m" } }, duration: 2 },
              {
                id: "right",
                content: { media: { mediaID: "m" } },
                start: 2,
                sourceStart: 2,
                duration: 2,
              },
            ],
            transitions: [
              {
                id: "crossfade",
                type: "dissolve",
                duration: 0.2,
                fromClipID: "left",
                toClipID: "right",
              },
            ],
          },
        ],
      },
    });
    const session = new ProjectCoordinator(file);
    session.apply({
      commands: [{ updateClip: { clipID: "left", patch: { audio: { gainDB: -3 } } } }],
    });
    const plan = restorePlan(session.projectFile(), file, { clips: ["left"] });
    session.apply({ commands: plan.commands });
    expect(session.getSnapshot().project.audioTracks[0]!.transitions[0]!.id).toBe("crossfade");
    expect(session.getSnapshot().project.audioTracks[0]!.clips[0]!.audio).toBeUndefined();
    session.apply({ commands: [{ removeClips: { clipIDs: ["left"], ripple: false } }] });
    const putBack = restorePlan(session.projectFile(), file, { clips: ["left"] });
    expect(putBack.problem).toBeUndefined();
    session.apply({ commands: putBack.commands });
    expect(session.getSnapshot().project.audioTracks[0]!.clips.map((c) => c.id)).toEqual([
      "left",
      "right",
    ]);
    expect(session.getSnapshot().project.audioTracks[0]!.transitions).toEqual([]);
  });
  it("accepts each pinned operation's request and rejects its malformed counterpart", () => {
    expect(contracts.operations).toHaveLength(21);
    expect(() => serviceRequest("constructor", {})).toThrow(/Unknown operation/);
    expect(() => serviceRequest("history", JSON.parse('{"constructor":null}'))).toThrow(/Unknown/);
    for (const operation of contracts.operations) {
      expect(() => serviceRequest(operation.name, operation.request)).not.toThrow();
      expect(() => serviceRequest(operation.name, operation.invalid)).toThrow();
    }
  });
  it("includes an explicit contact-sheet end and bounds the generated frame count", () => {
    expect(inspectionTimes({ every: 1, from: 0, to: 2 }, 3)).toEqual([0, 1, 2]);
    expect(inspectionTimes({ every: 1 }, 2)).toEqual([0, 1]);
    expect(inspectionTimes({ times: [1, 0, 1] }, 2)).toEqual([0, 1]);
    expect(() => inspectionTimes({ every: 0.001 }, 300)).toThrow(/1-48/);
    expect(() => inspectionTimes({ times: [0], from: 1 }, 2)).toThrow(/require every/);
  });
  it("reopens undo and redo history and resolves durable revision baselines", () => {
    const coordinator = new ProjectCoordinator(fixture());
    coordinator.apply({
      label: "Rename",
      author: "agent",
      commands: [{ updateProject: { patch: { name: "Changed" } } }],
    });
    const stored = decodeProjectFile(JSON.parse(encodeProjectFile(coordinator.projectFile())));
    replayJournal(stored);
    const reopened = new ProjectCoordinator(stored);
    expect(reopened.history().undo[0]).toEqual({ label: "Rename", author: "agent" });
    reopened.undo();
    const again = new ProjectCoordinator(
      decodeProjectFile(JSON.parse(encodeProjectFile(reopened.projectFile()))),
    );
    expect(again.getSnapshot().redoLabel).toBe("Rename");
    again.redo();
    expect(again.getSnapshot().project.name).toBe("Changed");
    expect(revisionFile(again.projectFile(), 0).project.name).toBe("Service fixture");
    expect(() => revisionFile(stored, 500)).toThrow(/not available/);
  });
  it("proposes clip restoration without mutating, checks invalid selection, and supports undo", () => {
    const original = fixture(),
      session = new ProjectCoordinator(original);
    session.apply({
      commands: [{ updateClip: { clipID: "speech", patch: { audio: { gainDB: -6 } } } }],
    });
    expect(clipChanges(original, session.projectFile())[0]).toMatchObject({
      id: "speech",
      kind: "changed",
    });
    const plan = restorePlan(session.projectFile(), original, { clips: ["speech"] });
    expect(plan.problem).toBeUndefined();
    expect(session.getSnapshot().revision).toBe(1);
    session.apply({ commands: plan.commands });
    expect(session.getSnapshot().project.audioTracks[0]!.clips[0]!.audio?.gainDB).toBeUndefined();
    session.undo();
    expect(session.getSnapshot().project.audioTracks[0]!.clips[0]!.audio?.gainDB).toBe(-6);
    expect(() => restorePlan(session.projectFile(), original, {})).toThrow(/Give clips/);
  });
  it("uses shared speech defaults, missing analysis and helper dry runs", () => {
    const file = fixture(),
      read = () => transcript;
    expect(speechQuery(file, "transcript", {}, read)).toMatchObject({
      scope: "timeline",
      timelineTimes: true,
      missing: [],
      words: transcript.words.map((word) => ({ ...word, clipID: "speech" })),
    });
    expect(speechQuery(file, "transcript", { id: "med_voice" }, () => undefined)).toMatchObject({
      scope: "media",
      missing: ["med_voice"],
      words: [],
    });
    expect(speechQuery(file, "search", { phrase: "new world" }, read)).toMatchObject({
      hits: [expect.objectContaining({ partial: false })],
    });
    expect(speechQuery(file, "pauses", {}, read)).toMatchObject({
      minimum: 0.6,
      pauses: [expect.objectContaining({ start: 0.3, end: 1.5 })],
    });
    expect(helperPlan(file, "tighten", {}, read).commands.length).toBeGreaterThan(0);
    expect(helperPlan(file, "captions", {}, read).commands.length).toBeGreaterThan(0);
    expect(helperPlan(file, "short", {}, read).commands.length).toBeGreaterThan(0);
    expect(helperPlan(file, "cards", { sounds: false }, read).commands.length).toBeGreaterThan(0);
    expect(helperPlan(file, "join", {}, read).commands).toEqual([]);
    expect(() => speechQuery(file, "transcript", { id: "absent" }, read)).toThrow(/No media/);
  });
  it("validates fields, ranges and array boundaries before crossing a renderer boundary", () => {
    expect(serviceRequest("frame", { time: "00:01.250", maxWidth: 320 })).toEqual({
      time: 1.25,
      maxWidth: 320,
    });
    expect(() => serviceRequest("apply", { commands: [], output: "../file" })).toThrow(/Unknown/);
    expect(() => serviceRequest("clip", { start: 2, end: 1 })).toThrow(/follow/);
    expect(() => serviceRequest("frames", { times: [-1] })).toThrow(/nonnegative/);
    expect(() => serviceRequest("transcribe", { media: [4] })).toThrow(/Invalid media/);
  });
});
