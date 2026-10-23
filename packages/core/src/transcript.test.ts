import { describe, it, expect } from "vite-plus/test";
import { decodeProjectFile } from "@sidecut/contracts/project";
import { placeWords, validateTranscript, type Transcript } from "./transcript";

const transcript: Transcript = {
  model: "fixture",
  language: "en",
  words: [{ text: "hello", start: 1, end: 2 }],
};
function clips(values: Record<string, unknown>[]) {
  return decodeProjectFile({
    revision: 0,
    project: {
      audioTracks: [
        {
          id: "voice",
          kind: "audio",
          clips: values.map((c, i) => ({
            id: `c${i}`,
            content: { media: { mediaID: "voice" } },
            duration: 1,
            ...c,
          })),
        },
      ],
    },
  }).project.audioTracks[0]!.clips;
}
describe("timeline word placement", () => {
  it("puts a word on the majority side of a cut and clamps it", () => {
    const result = placeWords(
      transcript,
      clips([
        { sourceStart: 1, duration: 0.6 },
        { sourceStart: 1.6, start: 0.6, duration: 0.4 },
      ]),
    );
    expect(result).toEqual([{ text: "hello", index: 0, clipID: "c0", start: 0, end: 0.6 }]);
  });
  it("chooses the earlier timeline clip on a half-word tie even in unordered input", () => {
    const result = placeWords(
      transcript,
      clips([
        { sourceStart: 1.5, start: 2, duration: 0.5 },
        { sourceStart: 1, start: 1, duration: 0.5 },
      ]),
    );
    expect(result).toMatchObject([{ clipID: "c1", start: 1, end: 1.5 }]);
  });
  it("unions kept source ranges instead of counting repeated fragments twice", () => {
    expect(
      placeWords(
        transcript,
        clips([
          { sourceStart: 1, duration: 0.3 },
          { sourceStart: 1, start: 2, duration: 0.3 },
        ]),
      ),
    ).toEqual([]);
    expect(
      placeWords(
        transcript,
        clips([
          { sourceStart: 1, duration: 0.3 },
          { sourceStart: 1.7, start: 2, duration: 0.3 },
        ]),
      ),
    ).toHaveLength(1);
  });
  it("shows a repeated majority twice and maps trims and speed in source time", () => {
    const result = placeWords(
      transcript,
      clips([
        { sourceStart: 1, duration: 0.5, speed: 2 },
        { sourceStart: 1, start: 3, duration: 2, speed: 0.5 },
      ]),
    );
    expect(result.map((w) => [w.start, w.end])).toEqual([
      [0, 0.5],
      [3, 5],
    ]);
  });
  it("skips freezes and disabled clips, retains zero-duration and overlapping engine words", () => {
    expect(
      placeWords(
        transcript,
        clips([
          { sourceStart: 1, freezeFrame: true },
          { sourceStart: 1, enabled: false },
        ]),
      ),
    ).toEqual([]);
    expect(
      placeWords(
        {
          ...transcript,
          words: [
            { text: "a", start: 1, end: 1 },
            { text: "b", start: 0.9, end: 1.2 },
          ],
        },
        clips([{ sourceStart: 0.5 }]),
      ),
    ).toHaveLength(2);
  });
  it("rejects corrupt cache timestamps", () => {
    expect(() =>
      validateTranscript({ ...transcript, words: [{ text: "bad", start: NaN, end: 1 }] }),
    ).toThrow(/timestamps/);
  });
});
