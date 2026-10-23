import { describe, it, expect } from "vite-plus/test";
import { decodeProjectFile, encodeProjectFile } from "@sidecut/contracts/project";
import { ProjectCoordinator } from "./coordinator";
import { placeWords, type Transcript } from "./transcript";
import {
  alignWords,
  findPauses,
  groupCaptions,
  pauseKind,
  phraseMatches,
  planCaptions,
  planTighten,
  searchSpeech,
  speechMap,
  tokens,
} from "./speech";

const transcript: Transcript = {
  model: "fixture",
  language: "en",
  words: [
    { text: "Hello,", start: 0.2, end: 0.6 },
    { text: "big", start: 1, end: 1.4 },
    { text: "world.", start: 1.8, end: 2.4 },
    { text: "Secret", start: 2.5, end: 2.8 },
    { text: "Don't", start: 3.2, end: 3.6 },
    { text: "stop", start: 4.4, end: 4.8 },
  ],
};
// Source 2-3 s is removed: "world." keeps 0.2 of 0.6 s and "Secret" is gone.
function file(extra: Record<string, unknown> = {}) {
  const clip = (id: string, start: number, sourceStart: number, link: string) => ({
    id,
    start,
    sourceStart,
    duration: 2,
    linkGroup: link,
    content: { media: { mediaID: "take" } },
  });
  return decodeProjectFile({
    revision: 3,
    project: {
      settings: { frameRate: { numerator: 30, denominator: 1 } },
      media: [{ id: "take", path: "take.webm", kind: "video", hasAudio: true, duration: 6 }],
      videoTracks: [
        { id: "camera", kind: "video", clips: [clip("v0", 0, 0, "a"), clip("v1", 2, 3, "b")] },
      ],
      audioTracks: [
        { id: "voice", kind: "audio", clips: [clip("a0", 0, 0, "a"), clip("a1", 2, 3, "b")] },
      ],
      ...extra,
    },
  });
}
const lookup = (value: Transcript | undefined) => () => value;

describe("speech search", () => {
  it("ignores case, apostrophes and punctuation", () => {
    expect(tokens("Don't, STOP!")).toEqual(["dont", "stop"]);
    expect(phraseMatches("dont stop", transcript)).toEqual([[4, 5]]);
    expect(phraseMatches("  ", transcript)).toEqual([]);
  });
  it("reports partial timeline matches and matches in removed source", () => {
    const result = searchSpeech(file(), "big world", lookup(transcript));
    expect(result.hits).toEqual([
      expect.objectContaining({
        start: 1,
        end: 1.4,
        clipIDs: ["v0", "a0"],
        partial: true,
        mediaStart: 1,
        mediaEnd: 2.4,
        before: "Hello,",
      }),
    ]);
    expect(searchSpeech(file(), "secret", lookup(transcript))).toMatchObject({
      hits: [],
      unused: [{ mediaID: "take", mediaStart: 2.5, mediaEnd: 2.8, text: "Secret" }],
    });
    const after = searchSpeech(file(), "DONT", lookup(transcript)).hits[0]!;
    expect([after.start, after.end, after.partial]).toEqual([2.2, 2.6, false]);
  });
  it("names speech sources without transcripts and rejects empty phrases", () => {
    expect(searchSpeech(file(), "hello", lookup(undefined)).missing).toEqual(["take"]);
    expect(() => searchSpeech(file(), "!!", lookup(transcript))).toThrow(/at least one word/);
  });
});

describe("pauses", () => {
  it("finds gaps between placed words inside transcribed coverage only", () => {
    const map = speechMap(file().project, lookup(transcript));
    expect(map.words.map((w) => w.text)).toEqual(["Hello,", "big", "Don't", "stop"]);
    const pauses = findPauses(map, 0.3);
    expect(pauses.map((p) => [p.start, p.end, p.before])).toEqual([
      [0.6, 1, "Hello,"],
      [1.4, 2.2, "Hello, big"],
      [2.6, 3.4, "Hello, big Don't"],
    ]);
    expect(pauses[1]!.clipIDs).toEqual(["a0", "a1"]);
  });
  it("does not treat missing transcripts or timeline holes as pauses", () => {
    expect(findPauses(speechMap(file().project, lookup(undefined)), 0.1)).toEqual([]);
    const gapped = decodeProjectFile({
      revision: 0,
      project: {
        media: [{ id: "take", path: "take.webm", kind: "audio", duration: 6 }],
        audioTracks: [
          {
            kind: "audio",
            clips: [
              { id: "x", duration: 1.5, content: { media: { mediaID: "take" } } },
              {
                id: "y",
                start: 3,
                sourceStart: 3,
                duration: 2,
                content: { media: { mediaID: "take" } },
              },
            ],
          },
        ],
      },
    });
    const map = speechMap(gapped.project, lookup(transcript));
    expect(findPauses(map, 0.3).map((p) => p.start)).toEqual([0.6, 3.6]);
  });
  it("classifies pauses by the punctuation before them", () => {
    expect(["Hello, big", 'said."', "wait;", "and"].map(pauseKind)).toEqual([
      "mid",
      "sentence",
      "comma",
      "mid",
    ]);
  });
  it("pulls word edges to waveform activity", () => {
    const peaks = new Float32Array(300).fill(0.001);
    peaks.fill(0.5, 50, 100);
    peaks.fill(0.5, 150, 200);
    const words = alignWords(
      [
        { text: "hello,", start: 0.3, end: 1.4 },
        { text: "world", start: 1.4, end: 2.2 },
      ],
      peaks,
      100,
    );
    expect(words.map((w) => [w.start, w.end])).toEqual([
      [0.5, 1],
      [1.5, 2],
    ]);
  });
});

describe("tighten", () => {
  it("previews frame-aligned cuts that the coordinator applies with one undo", () => {
    const start = file();
    const plan = planTighten(start, { min: 0.6, keep: 0.15 }, lookup(transcript));
    expect(plan.cuts.map((c) => [c.cut.start, c.cut.end])).toEqual([
      [1.5, 2.1],
      [2.7, 3.3],
    ]);
    expect(plan.removed).toBeCloseTo(1.2, 9);
    expect(plan.commands).toHaveLength(2);
    const coordinator = new ProjectCoordinator(start);
    coordinator.apply({ label: plan.label, commands: plan.commands, expectedRevision: 3 });
    const after = coordinator.getSnapshot().project;
    expect(plan.durationAfter).toBeCloseTo(2.8, 6);
    for (const track of [after.videoTracks[0]!, after.audioTracks[0]!])
      expect(track.clips.map((c) => Number(c.start.seconds.toFixed(6)))).toEqual([0, 1.5, 2.1]);
    // The re-run against the edited project finds the same speech, now tightened.
    expect(
      planTighten(coordinator.getSnapshot(), { min: 0.6, keep: 0.15 }, lookup(transcript)).cuts,
    ).toEqual([]);
    coordinator.undo();
    expect(encodeProjectFile({ revision: 0, project: coordinator.getSnapshot().project })).toEqual(
      encodeProjectFile({ revision: 0, project: start.project }),
    );
  });
  it("keeps by what a pause follows, protects times and validates options", () => {
    const plan = planTighten(file(), { mike: true }, lookup(transcript));
    expect(plan.cuts.map((c) => [c.kind, c.keep])).toEqual([
      ["mid", 0.08],
      ["mid", 0.08],
    ]);
    expect(planTighten(file(), { protect: [1.8] }, lookup(transcript)).protected).toHaveLength(1);
    expect(() => planTighten(file(), { keep: 0.7 }, lookup(transcript))).toThrow(/shorter/);
    expect(() => planTighten(file(), { mike: true, keep: 0.1 }, lookup(transcript))).toThrow();
  });
  it("warns before tightening a locked take", () => {
    const locked = file();
    const project = {
      ...locked.project,
      videoTracks: [{ ...locked.project.videoTracks[0]!, locked: true }],
    };
    expect(planTighten({ ...locked, project }, {}, lookup(transcript)).locked).toMatch(/locked/);
  });
});

describe("captions", () => {
  it("captions exactly the words the transcript lane shows through a cut", () => {
    const start = file();
    const lane = placeWords(transcript, start.project.audioTracks[0]!.clips).map((w) => w.text);
    const plan = planCaptions(start, { words: 2 }, lookup(transcript), () => "trk_captions");
    expect(plan.captions.flatMap((c) => c.text.split(" "))).toEqual(lane);
    expect(plan.captions.map((c) => [c.start, c.end, c.text])).toEqual([
      [0.2, 0.8, "Hello,"],
      [1, 1.6, "big"],
      [2.2, 2.8, "Don't"],
      [3.4, 4, "stop"],
    ]);
    const coordinator = new ProjectCoordinator(start);
    coordinator.apply({ label: plan.label, commands: plan.commands });
    const track = coordinator.getSnapshot().project.videoTracks.find((t) => t.name === "Captions")!;
    expect(track.rippleMode).toBe("follow");
    expect(track.clips[0]!.content.text).toMatchObject({
      preset: "caption",
      words: [{ text: "Hello,", start: 0, end: 0.4 }],
    });
    coordinator.undo();
    expect(coordinator.getSnapshot().project.videoTracks).toHaveLength(1);
  });
  it("breaks at sentence ends and holds without overlapping the next caption", () => {
    const words = [
      { text: "One.", start: 0, end: 0.3, clipID: "c", mediaID: "m" },
      { text: "Two", start: 0.4, end: 0.6, clipID: "c", mediaID: "m" },
      { text: "Two", start: 0.4, end: 0.6, clipID: "d", mediaID: "m" },
    ];
    expect(
      groupCaptions(words, 3, { numerator: 10, denominator: 1 }).map((c) => [c.start, c.end]),
    ).toEqual([
      [0, 0.4],
      [0.4, 0.8],
    ]);
  });
});
