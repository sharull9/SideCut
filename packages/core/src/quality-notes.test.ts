import { describe, it, expect } from "vite-plus/test";
import { decodeProjectFile, encodeProjectFile } from "@sidecut/contracts/project";
import { pageNotes, lowRateNotes, deadAirNotes, screenProject, isScroll } from "./quality-notes";
import { wireFile } from "./service-edits";
import type { FrameStats } from "./quality-check";
import { frameProblems } from "./quality-check";
import { ProjectCoordinator } from "./coordinator";
const project = () =>
  decodeProjectFile({
    revision: 0,
    project: {
      id: "screen-check",
      settings: { width: 160, height: 90 },
      media: [
        {
          id: "screen",
          path: "screen.webm",
          kind: "video",
          role: "screen",
          hasVideo: true,
          width: 160,
          height: 90,
          duration: 3,
        },
      ],
      videoTracks: [
        {
          id: "v",
          kind: "video",
          clips: [{ id: "screen-clip", content: { media: { mediaID: "screen" } }, duration: 3 }],
        },
      ],
    },
  }).project;
const stats = (color: (i: number) => number): FrameStats[] =>
  Array.from({ length: 90 }, (_, i) => ({
    time: i / 30,
    luma: color(i) / 255,
    brightestTile: color(i) / 255,
    flatGreen: 0,
    flatWhite: 0,
    thumbnail: Array.from({ length: 144 }, () => color(i)),
  }));
const ranges = [{ start: 0, end: 3 }];
describe("126.02 advanced notes", () => {
  it("offers a valid one-step hold-frame fix for an unambiguous flash", () => {
    const p = project(),
      file = { revision: 0, project: p },
      before = encodeProjectFile(file),
      frames = stats((i) => (i === 30 ? 120 : 70));
    const found = frameProblems(p, frames, []),
      flash = found.find((item) => item.kind === "flicker");
    expect(flash?.fix).toMatchObject({ holdFrame: { clipID: "screen-clip", range: { start: 1 } } });
    if (!flash?.fix) throw new Error("Expected hold-frame fix.");
    const session = new ProjectCoordinator(file);
    session.apply({ commands: [flash.fix] });
    session.undo();
    expect(encodeProjectFile({ revision: 0, project: session.getSnapshot().project })).toBe(before);
  });
  it("detects a page settling after a large change and excludes occluded screens", () => {
    const p = project(),
      frames = stats((i) => (i < 30 ? 20 : 100));
    expect(pageNotes(p, ranges, frames)).toMatchObject([
      { kind: "pageChange", start: 1, clipIDs: ["screen-clip"] },
    ]);
    const covering = decodeProjectFile({
      revision: 0,
      project: {
        id: "cover",
        media: wireFile({ revision: 0, project: p }).project.media,
        videoTracks: [
          ...(wireFile({ revision: 0, project: p }).project.videoTracks ?? []),
          {
            id: "top",
            kind: "video",
            clips: [
              {
                id: "cover",
                duration: 3,
                content: { solid: { color: { r: 1, g: 0, b: 0, a: 1 } } },
              },
            ],
          },
        ],
      },
    }).project;
    expect(pageNotes(covering, ranges, frames)).toEqual([]);
    expect(screenProject(covering)?.videoTracks[1]?.clips).toEqual([]);
  });
  it("distinguishes a scroll from a new page using independent scanline bands", () => {
    const before = Array.from({ length: 120 }, (_, i) => ((i % 30) * 13) % 255),
      after = Array.from({ length: 120 }, (_, i) => (((i % 30) + 3) * 13) % 255);
    expect(isScroll(before, after)).toBe(true);
    expect(
      isScroll(
        before,
        Array.from({ length: 120 }, () => 70),
      ),
    ).toBe(false);
  });
  it("uses source frame arrivals and visible motion to report a low frame rate", () => {
    const p = project(),
      times = new Map([["screen", Array.from({ length: 15 }, (_, i) => i / 5)]]),
      moving = stats((i) => (Math.floor(i / 6) % 2 ? 70 : 100));
    expect(lowRateNotes(p, ranges, moving, times)).toMatchObject([
      { kind: "lowFrameRate", start: 0, end: 3, clipIDs: ["screen-clip"] },
    ]);
    expect(
      lowRateNotes(
        p,
        ranges,
        stats(() => 70),
        times,
      ),
    ).toEqual([]);
    expect(lowRateNotes(p, ranges, moving, new Map())).toEqual([]);
  });
  it("reports still silence but protects animation, missing transcripts and intentional gaps", () => {
    const p = project(),
      still = stats(() => 70);
    expect(deadAirNotes(p, ranges, still, () => undefined, [])).toMatchObject([
      { kind: "deadAir", start: 0, end: 3 },
    ]);
    expect(
      deadAirNotes(
        p,
        ranges,
        stats((i) => (Math.floor(i / 6) % 2 ? 70 : 100)),
        () => undefined,
        [],
      ),
    ).toEqual([]);
    expect(
      deadAirNotes(p, ranges, still, () => undefined, [
        { kind: "gap", start: 0, end: 3, message: "gap", clipIDs: [] },
      ]),
    ).toEqual([]);
    const unknown = decodeProjectFile({
      revision: 0,
      project: {
        id: "unknown",
        videoTracks: wireFile({ revision: 0, project: p }).project.videoTracks,
        media: [
          ...(wireFile({ revision: 0, project: p }).project.media ?? []),
          { id: "voice", path: "voice.wav", kind: "audio", hasAudio: true },
        ],
        audioTracks: [
          {
            id: "a",
            kind: "audio",
            rippleMode: "cut",
            clips: [{ id: "speech", duration: 3, content: { media: { mediaID: "voice" } } }],
          },
        ],
      },
    }).project;
    expect(deadAirNotes(unknown, ranges, still, () => undefined, [])).toEqual([]);
  });
});
