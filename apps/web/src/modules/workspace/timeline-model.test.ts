import { describe, expect, it } from "vite-plus/test";
import { decodeProjectFile } from "@sidecut/contracts/project";
import { Time } from "@sidecut/contracts/time";
import {
  activeClips,
  atFrame,
  stepFrame,
  projectDuration,
  sourceTime,
  previewIssue,
} from "./timeline-model";
import { createEditorView } from "./editor-view";

const project = () =>
  decodeProjectFile({
    revision: 0,
    project: {
      settings: { frameRate: { numerator: 30000, denominator: 1001 } },
      media: [{ id: "med", path: "test.webm" }],
      videoTracks: [
        {
          id: "trk",
          kind: "video",
          clips: [
            {
              id: "clip",
              start: 1,
              duration: 10,
              sourceStart: 2,
              content: { media: { mediaID: "med" } },
            },
          ],
        },
      ],
    },
  }).project;

describe("timeline view model", () => {
  it("steps fractional frames without accumulating sample-rounding drift", () => {
    const value = project();
    let time = new Time(0n);
    for (let frame = 0; frame < 100; frame++) time = stepFrame(time, 1, value);
    expect(time.flicks).toBe(Time.frames(100n, value.settings.frameRate).flicks);
    expect(atFrame(time.seconds, value).flicks).toBe(time.flicks);
    expect(stepFrame(new Time(0n), -1, value).flicks).toBe(0n);
  });
  it("maps source timestamps, gap boundaries and project extent", () => {
    const value = project();
    expect(projectDuration(value).seconds).toBe(11);
    expect(activeClips(value, 0, "video")).toEqual([]);
    expect(activeClips(value, 11, "video")).toEqual([]);
    expect(sourceTime(value.videoTracks[0]!.clips[0]!, 1.5)).toBe(2.5);
    expect(previewIssue(value, 1.5)).toBeNull();
    expect(
      previewIssue(
        {
          ...value,
          media: value.media.map((item) => ({ ...item, look: [{ type: "colorAdjust" }] })),
        },
        1.5,
      ),
    ).toBeNull();
    const stacked = {
      ...value,
      videoTracks: [...value.videoTracks, { ...value.videoTracks[0]!, id: "trk_upper" }],
    };
    expect(previewIssue(stacked, 1.5)).toBeNull();
    expect(
      activeClips(
        {
          ...stacked,
          videoTracks: stacked.videoTracks.map((track, index) => ({
            ...track,
            hidden: index === 1,
          })),
        },
        1.5,
        "video",
      ),
    ).toHaveLength(1);
  });
  it("keeps selection, seeking and zoom transient and isolated per editor", () => {
    const first = createEditorView(),
      second = createEditorView();
    first.getState().select("a");
    first.getState().select("b", true);
    first.getState().select("a", true);
    expect(first.getState().selected).toEqual(["b"]);
    expect(second.getState().selected).toEqual([]);
    first.getState().seek(Time.fromSeconds(2));
    expect(first.getState().seekVersion).toBe(1);
    first.getState().setZoom(99999);
    expect(first.getState().zoom).toBe(600);
    first.getState().reset();
    expect(first.getState().playhead.flicks).toBe(0n);
  });
});
