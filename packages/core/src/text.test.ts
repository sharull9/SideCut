import { describe, it, expect } from "vite-plus/test";
import { decodeProjectFile, encodeProjectFile } from "@sidecut/contracts/project";
import {
  animationState,
  currentWord,
  easeOutBack,
  fontsourceID,
  missingFonts,
  missingFontWarning,
  resolveText,
  styleFor,
  textAnimation,
  textContent,
  textIssue,
  wordRange,
} from "./text";

const project = (schemaVersion: number, text: Record<string, unknown>) =>
  decodeProjectFile({
    revision: 0,
    project: {
      schemaVersion,
      videoTracks: [{ kind: "video", clips: [{ id: "title", duration: 2, content: { text } }] }],
    },
  });

describe("text styles", () => {
  it("applies clip style over preset over defaults, including explicit defaults", () => {
    expect(styleFor({ text: "a", preset: "label", style: { uppercase: false } })).toMatchObject({
      font: "SF Pro Display",
      size: 64,
      uppercase: false,
      shadow: true,
    });
    const callout = styleFor({ text: "a", preset: "CALLOUT", style: {} });
    expect(callout.backgroundColor).toEqual({ r: 1, g: 0.8, b: 0.16, a: 1 });
    // A see-through box switches the preset's box off.
    expect(
      styleFor({
        text: "a",
        preset: "callout",
        style: { backgroundColor: { r: 0, g: 0, b: 0, a: 0 } },
      }).backgroundColor,
    ).toBeNull();
  });
  it("round-trips legacy and current styles", () => {
    const legacy = project(1, {
      text: "hi",
      preset: "label",
      style: { uppercase: false, size: 64, shadow: true, color: { r: 1, g: 1, b: 1, a: 1 } },
      animationDuration: 0.4,
    });
    const clip = legacy.project.videoTracks[0]!.clips[0]!;
    // Schema 1 defaults meant "not set", so the label preset shouts again.
    expect(clip.content.text).toEqual({ text: "hi", preset: "label", style: { shadow: true } });
    expect(styleFor(textContent(clip)!).uppercase).toBe(true);
    const current = project(2, { text: "hi", preset: "label", style: { uppercase: false } });
    const again = decodeProjectFile(JSON.parse(encodeProjectFile(current)));
    expect(again.project.schemaVersion).toBe(2);
    expect(styleFor(textContent(again.project.videoTracks[0]!.clips[0]!)!).uppercase).toBe(false);
    expect(JSON.parse(encodeProjectFile(again)).project.videoTracks[0].clips[0].content).toEqual({
      text: { text: "hi", preset: "label", style: { uppercase: false } },
    });
  });
  it("rejects undrawable fields while preserving unknown ones", () => {
    expect(textIssue({ text: "a", style: { size: "big" } })).toMatch(/size/);
    expect(textIssue({ text: "a", style: { color: { r: 2, g: 0, b: 0 } } })).toMatch(/color/);
    expect(textIssue({ text: "a", future: { x: 1 }, style: { future: true } })).toBeNull();
  });
});

describe("title animation", () => {
  const label = resolveText({ text: "Hi", preset: "label", style: {} });
  it("uses preset animations and lets a clip switch them off", () => {
    expect([label.animationIn, label.animationOut, label.animationDuration]).toEqual([
      "fade",
      "fade",
      0.25,
    ]);
    const off = resolveText({ text: "Hi", preset: "label", style: {}, animationIn: "none" });
    expect(off.animationIn).toBeNull();
    expect(textAnimation("popIn")).toBe("pop");
    expect(label.text).toBe("HI");
  });
  it("matches the reference animation boundaries", () => {
    expect(animationState(0, 2, label).opacity).toBe(0);
    expect(animationState(0.125, 2, label).opacity).toBeCloseTo(0.5, 9);
    expect(animationState(0.25, 2, label)).toEqual({
      opacity: 1,
      scale: 1,
      offsetY: 0,
      visibleFraction: 1,
    });
    expect(animationState(2, 2, label).opacity).toBe(0);
    // Animations take at most half a short clip.
    expect(animationState(0.1, 0.2, label).opacity).toBe(1);
    const pop = resolveText({ text: "v1", preset: "version", style: {} });
    expect(animationState(0, 2, pop).scale).toBeCloseTo(0, 9);
    expect(Math.max(...[0.5, 0.6, 0.7, 0.8].map(easeOutBack))).toBeGreaterThan(1.05);
    const header = resolveText({ text: "A\nB", preset: "sectionHeader", style: {} });
    expect(animationState(0, 3, header).offsetY).toBeCloseTo(0.06, 9);
    expect(animationState(3, 3, header).offsetY).toBe(0);
    const typed = resolveText({ text: "abcd", style: {}, animationIn: "typewriter" });
    expect(animationState(0.2, 2, typed).visibleFraction).toBeCloseTo(0.5, 9);
  });
  it("highlights the spoken word by clip-relative timings", () => {
    const caption = resolveText({
      text: "ignored",
      preset: "caption",
      style: { uppercase: true },
      words: [
        { text: "one", start: 0, end: 0.3 },
        { text: "two", start: 0.5, end: 0.8 },
      ],
    });
    expect(caption.text).toBe("ONE TWO");
    expect([0, 0.4, 0.5, 2].map((t) => currentWord(caption, t))).toEqual([0, 0, 1, 1]);
    expect(wordRange(caption, 1)).toEqual([4, 7]);
  });
});

describe("fonts", () => {
  it("reports missing named and preset fonts with their install source", () => {
    const file = decodeProjectFile({
      revision: 0,
      project: {
        videoTracks: [
          {
            kind: "video",
            clips: [
              { id: "a", duration: 1, content: { text: { text: "x", preset: "caption" } } },
              {
                id: "b",
                start: 1,
                duration: 1,
                content: { text: { text: "y", style: { font: "Kanit-Bold" } } },
              },
              { id: "c", start: 2, duration: 1, content: { text: { text: "z" } } },
              {
                id: "d",
                start: 3,
                duration: 1,
                content: { text: { text: "w", style: { font: "TILT WARP" } } },
              },
            ],
          },
        ],
      },
    });
    const missing = missingFonts(file.project, (name) => name === "Arial");
    expect(missing).toEqual([
      {
        name: "Tilt Warp",
        clipIDs: ["a", "d"],
        presetID: "caption",
        assetID: "fontsource:tilt-warp",
      },
      { name: "Kanit-Bold", clipIDs: ["b"], presetID: null, assetID: "fontsource:kanit" },
    ]);
    expect(missingFontWarning(missing[0]!)).toMatch(/2 text clips are drawn in the system font/);
    expect(fontsourceID("TiltWarp-Regular")).toBe("fontsource:tilt-warp");
  });
});
