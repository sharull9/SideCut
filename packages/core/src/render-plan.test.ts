import { describe, expect, it } from "vite-plus/test";
import { decodeProjectFile } from "@sidecut/contracts/project";
import { exportPlan } from "./render-plan";

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
  it("rejects unsupported processing, stacking, empty, long and excessive-frame-rate projects", () => {
    expect(() => exportPlan(project([]))).toThrow(/Place a source/);
    expect(() =>
      exportPlan(project([{ id: "v", kind: "video", clips: [{ ...clip, duration: 301 }] }])),
    ).toThrow(/five minutes/);
    expect(() =>
      exportPlan(
        project([{ id: "v", kind: "video", clips: [clip] }], [], {
          frameRate: { numerator: 120, denominator: 1 },
        }),
      ),
    ).toThrow(/60 fps/);
    expect(() =>
      exportPlan(project([{ id: "v", kind: "video", clips: [{ ...clip, speed: 2 }] }])),
    ).toThrow(/rendering features/);
    expect(() =>
      exportPlan(
        project([
          { id: "v", kind: "video", clips: [clip] },
          { id: "v2", kind: "video", clips: [{ ...clip, id: "other" }] },
        ]),
      ),
    ).toThrow(/Compositing/);
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
  it("rounds export length to complete output frames", () => {
    expect(
      exportPlan(project([{ id: "v", kind: "video", clips: [{ ...clip, duration: 1.25 }] }]))
        .duration,
    ).toBe(38 / 30);
  });
});
