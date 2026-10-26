import { describe, expect, it } from "vite-plus/test";
import { decodeProjectFile } from "@sidecut/contracts/project";
import { exportPlan, framePlan } from "./render-plan";

const clip = { id: "clip", start: 0, duration: 2, content: { media: { mediaID: "media" } } };
function project(video: unknown[], audio: unknown[] = [], settings: unknown = {}) {
  return decodeProjectFile({
    revision: 0,
    project: {
      id: "export",
      settings,
      media: [{ id: "media", path: "source.webm", hasVideo: true, hasAudio: true, duration: 400 }],
      videoTracks: video,
      audioTracks: audio,
    },
  }).project;
}
describe("browser export preflight", () => {
  it("validates only the selected range and detects audio within that range", () => {
    const value = project(
      [
        {
          id: "v",
          kind: "video",
          clips: [
            { ...clip, duration: 301 },
            {
              id: "bad",
              start: 302,
              duration: 1,
              content: { graphic: { template: "unsupported" } },
            },
          ],
        },
      ],
      [{ id: "a", kind: "audio", clips: [{ ...clip, id: "audio", start: 2 }] }],
    );
    expect(exportPlan(value, true, { start: 0, end: 1 })).toMatchObject({
      duration: 1,
      frameCount: 30,
      hasAudio: false,
    });
    expect(exportPlan(value, true, { start: 2, end: 3 }).hasAudio).toBe(true);
    expect(() => exportPlan(value, true, { start: 302, end: 303 })).toThrow();
    for (const range of [
      { start: -1, end: 1 },
      { start: 1, end: 1 },
      { start: 0, end: 304 },
      { start: NaN, end: 1 },
    ])
      expect(() => exportPlan(value, true, range)).toThrow("Invalid export range");
  });
  it("does not create a sound track for a frozen audio-only sequence", () => {
    expect(
      exportPlan(project([], [{ id: "a", kind: "audio", clips: [{ ...clip, freezeFrame: true }] }]))
        .hasAudio,
    ).toBe(false);
  });
  it("caps landscape and portrait output and detects silent sequences", () => {
    const video = [{ id: "picture", kind: "video", clips: [clip] }];
    expect(exportPlan(project(video))).toMatchObject({
      width: 1920,
      height: 1080,
      duration: 2,
      hasAudio: false,
    });
    expect(exportPlan(project(video, [], { width: 2160, height: 3840 }))).toMatchObject({
      width: 1080,
      height: 1920,
    });
  });
  it("honors solo, hidden, track mute and clip mute without requiring their missing media", () => {
    const p = project(
      [
        { id: "picture", kind: "video", solo: true, clips: [clip] },
        {
          id: "ignored",
          kind: "video",
          clips: [{ ...clip, id: "ignored", content: { text: { text: "unsupported" } } }],
        },
      ],
      [{ id: "sound", kind: "audio", clips: [{ ...clip, id: "sound", audio: { muted: true } }] }],
    );
    expect(exportPlan(p).hasAudio).toBe(false);
  });
  it("supports long and high-frame-rate projects while rejecting invalid or unsupported processing", () => {
    expect(() => exportPlan(project([]))).toThrow(/Place a source/);
    expect(
      exportPlan(project([{ id: "v", kind: "video", clips: [{ ...clip, duration: 301 }] }])),
    ).toMatchObject({ frameCount: 9030 });
    expect(
      exportPlan(
        project([{ id: "v", kind: "video", clips: [clip] }], [], {
          frameRate: { numerator: 120, denominator: 1 },
        }),
      ),
    ).toMatchObject({ fps: 120, frameCount: 240 });
    expect(
      exportPlan(project([], [{ id: "v", kind: "audio", clips: [{ ...clip, speed: 2 }] }]))
        .hasAudio,
    ).toBe(true);
    expect(() =>
      exportPlan(
        project([], [{ id: "v", kind: "audio", clips: [{ ...clip, audio: { pan: 1 } }] }]),
      ),
    ).toThrow(/panning/);
  });
  it("accepts neutral audio properties on ordinary cuts", () => {
    expect(
      exportPlan(
        project(
          [],
          [
            {
              id: "sound",
              kind: "audio",
              clips: [
                {
                  ...clip,
                  audio: {
                    muted: false,
                    gainDB: 0,
                    pan: 0,
                    fadeIn: 0,
                    fadeOut: 0,
                    effects: [],
                    normalizeTo: null,
                  },
                },
              ],
            },
          ],
        ),
      ).hasAudio,
    ).toBe(true);
  });
  it("renders titles and names undrawable title styles", () => {
    const title = {
      id: "t",
      start: 1,
      duration: 2,
      content: { text: { text: "Hi", preset: "label" } },
    };
    const p = project([{ id: "v", kind: "video", clips: [title] }]);
    expect(exportPlan(p).duration).toBe(3);
    expect(framePlan(p, 1.5).layers[0]).toMatchObject({ mediaID: null, clipTime: 0.5 });
    const bad = { ...title, content: { text: { text: "Hi", style: { weight: "bold" } } } };
    expect(() => exportPlan(project([{ id: "v", kind: "video", clips: [bad] }]))).toThrow(
      /weight must be a number/,
    );
  });
  it("rounds export length to complete output frames", () => {
    expect(
      exportPlan(project([{ id: "v", kind: "video", clips: [{ ...clip, duration: 1.25 }] }]))
        .duration,
    ).toBe(38 / 30);
  });
});
