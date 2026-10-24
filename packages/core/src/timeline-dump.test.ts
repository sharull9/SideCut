import { describe, it, expect } from "vite-plus/test";
import { decodeProjectFile, encodeProjectFile } from "@sidecut/contracts/project";
import { queryTimeline, queryRequest, parseQueryTime } from "./project-queries";

const file = () =>
  decodeProjectFile({
    revision: 7,
    project: {
      id: "p",
      name: "Dump fixture",
      settings: { width: 640, height: 360 },
      media: [
        {
          id: "m",
          path: "take-camera.mov",
          kind: "video",
          role: "camera",
          duration: 20,
          hasAudio: true,
        },
      ],
      videoTracks: [
        {
          id: "v",
          kind: "video",
          name: "Camera",
          clips: [
            {
              id: "c1",
              start: 1,
              duration: 2,
              sourceStart: 2,
              content: { media: { mediaID: "m" } },
              video: {
                transform: { scale: 0.5, position: { x: 0.8, y: 0.7 } },
                opacity: 0.6,
                cutout: { enabled: true },
              },
              linkGroup: "take",
              tags: ["sample"],
            },
            {
              id: "c2",
              start: 3,
              duration: 2,
              sourceStart: 4,
              content: { media: { mediaID: "m" } },
            },
          ],
          transitions: [
            {
              id: "tr",
              type: "push",
              direction: "left",
              duration: 0.5,
              fromClipID: "c1",
              toClipID: "c2",
            },
          ],
        },
      ],
      audioTracks: [
        {
          id: "a",
          kind: "audio",
          name: "Voice",
          clips: [
            {
              id: "s",
              start: 1,
              duration: 4,
              sourceStart: 2,
              content: { media: { mediaID: "m" } },
              audio: { gainDB: -3.14, normalizeTo: -20, fadeIn: 0.25 },
              linkGroup: "take",
            },
          ],
        },
      ],
      markers: [
        { id: "mk", name: "Review", kind: "todo", time: 2, duration: 0.5, note: "Check cut" },
      ],
    },
  });
describe("120.02 timeline dump", () => {
  it("renders reference structure, settings, gaps, links, transitions and media without editing", () => {
    const value = file(),
      before = encodeProjectFile(value);
    const text = queryTimeline(value, {}).text!;
    expect(text).toContain(
      "Dump fixture: 00:05.000 long, 640x360 at 30 fps, revision 7\nTracks top to bottom",
    );
    expect(text).toContain('00:02.000-00:02.500  todo  "Review" (Check cut)  mk');
    expect(text).toContain("gap 00:00.000-00:01.000 (1.000s)");
    expect(text).toContain("linked #1  scale 0.5 at 0.8,0.7  opacity 0.6  cutout person  #sample");
    expect(text).toContain("~ push left 0.500s into c2  tr");
    expect(text).toContain("gain -3.1 dB  level -20 LUFS  fade in 0.250s");
    expect(text).toContain("\nMedia\n  m  take-camera.mov  camera  00:20.000\n");
    expect(encodeProjectFile(value)).toBe(before);
  });
  it("filters clips, transitions and marker spans together and summarizes the entire project", () => {
    const value = file();
    const filtered = queryTimeline(value, { from: 3, to: 4, format: "json" }).project;
    expect(filtered.videoTracks[0].clips.map((c: { id: string }) => c.id)).toEqual(["c2"]);
    expect(filtered.videoTracks[0].transitions).toEqual([]);
    expect(filtered.markers).toEqual([]);
    const summary = queryTimeline(value, { summary: true, from: 100, to: 101 }).text!;
    expect(summary).toContain("Tracks, top to bottom");
    expect(summary).toContain("4.000s of content");
    expect(summary).toContain("1 transition");
    expect(summary).toContain('todo  "Review"');
    expect(summary).not.toContain("take-camera.mov [");
  });
  it("reads cached words in clip clocks, truncates range text and reports missing transcripts", () => {
    const value = file(),
      transcript = {
        model: "fixture",
        language: "en",
        words: [
          { text: "Hello", start: 2.1, end: 2.5 },
          { text: "world", start: 3.1, end: 3.5 },
        ],
      };
    expect(queryTimeline(value, { words: true }, () => transcript).text).toContain(
      '      "Hello world"',
    );
    expect(queryTimeline(value, { words: true, from: 2, to: 3 }, () => transcript).text).toContain(
      '      "...world"',
    );
    const missing = queryTimeline(value, { words: true }).text!;
    expect(missing.match(/No transcript yet for m/g)).toHaveLength(1);
    expect(missing).not.toContain("Speech words are unavailable");
  });
  it("prints majority settings once with exceptions, text styles and empty tracks", () => {
    const clips = Array.from({ length: 5 }, (_, i) => ({
      id: `c${i}`,
      start: i,
      duration: 1,
      content: {
        text: { text: "Hello", style: { font: "Fixture", shadow: false }, animationIn: "fadeIn" },
      },
      video: i < 4 ? { opacity: 0.6 } : {},
      keyframes: {
        "video.opacity": [
          { time: 0, value: 1 },
          { time: 1, value: 0 },
        ],
      },
    }));
    const value = decodeProjectFile({
      revision: 0,
      project: {
        videoTracks: [{ id: "v", kind: "video", clips }],
        audioTracks: [{ id: "a", kind: "audio", clips: [] }],
      },
    });
    const text = queryTimeline(value, {}).text!;
    expect(text).toContain(
      "most clips: opacity 0.6, in fadeIn, style font=Fixture shadow=false, animates opacity",
    );
    expect(text).toContain("not: opacity 0.6");
    expect(text).toContain("(empty)");
    expect(queryTimeline(value, { from: 10 }).text).toContain("(nothing here in this range)");
  });
  it("accepts reference time spelling and rejects malformed or unsupported-range inputs", () => {
    expect(parseQueryTime(" 1:02:03.25s ")).toBe(3723.25);
    expect(queryTimeline(file(), { from: "-1s", to: ".5s" }).text).toContain(
      "Showing -00:01.000 to 00:00.500",
    );
    for (const from of ["1:60", "1:2:3:4", "1.5:00", "bad", Infinity])
      expect(() => queryRequest("timeline", { from })).toThrow();
    expect(() => parseQueryTime(-1)).toThrow();
    expect(() => queryTimeline(file(), { format: "xml" })).toThrow();
  });
});
