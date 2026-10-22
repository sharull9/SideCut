import { describe, expect, it } from "vite-plus/test";
import { decodeProjectFile, encodeProjectFile } from "@sidecut/contracts/project";
import { ProjectCoordinator, replayJournal } from "./coordinator";
import { easing, interpolate, keyframeValue, resolveClip } from "./keyframes";
import { regionTransform, motionEnds, identity } from "./picture-editing";
import { exportPlan, framePlan, sourceCrop } from "./render-plan";

function fixture(video: unknown = {}, keyframes: unknown = {}) {
  return decodeProjectFile({
    revision: 0,
    project: {
      id: "picture",
      settings: { width: 1920, height: 1080 },
      media: [
        {
          id: "media",
          path: "photo.png",
          kind: "image",
          role: "camera",
          width: 1920,
          height: 1080,
        },
      ],
      videoTracks: [
        {
          id: "track",
          kind: "video",
          clips: [
            {
              id: "clip",
              start: 5,
              duration: 4,
              content: { media: { mediaID: "media" } },
              video,
              keyframes,
            },
          ],
        },
      ],
    },
  });
}
const picture = (c: ProjectCoordinator) => c.getSnapshot().project.videoTracks[0]!.clips[0]!;
const apply = (c: ProjectCoordinator, command: unknown) => c.apply({ commands: [command] });
describe("crop and picture commands", () => {
  it("clamps source fractions without changing the uncropped placement", () => {
    const clip = fixture({ crop: { left: 0.25, top: 0.1, right: 0.1, bottom: 0.2 } }).project
      .videoTracks[0]!.clips[0]!;
    expect(sourceCrop(clip, 200, 100)).toEqual({ x: 50, y: 10, width: 130, height: 70 });
    expect(
      sourceCrop(
        { ...clip, video: { crop: { left: 0.8, right: 0.8, top: -1, bottom: 2 } } },
        200,
        100,
      ),
    ).toEqual({ x: 160, y: 0, width: 0, height: 0 });
    expect(exportPlan(fixture({ opacity: 0.5, crop: { left: 0.2 } }).project).duration).toBe(9);
  });
  it("applies PiP with reference cutout/shadow defaults and removes them on full reset", () => {
    const c = new ProjectCoordinator(
      fixture(
        { effects: [{ id: "grade", type: "custom", params: { keep: 1 } }] },
        {
          "video.transform.rotation": [{ time: 0, value: 12 }],
          "video.opacity": [{ time: 0, value: 0.7 }],
        },
      ),
    );
    apply(c, { applyLayout: { clipIDs: ["clip"], preset: "pipRight" } });
    expect(picture(c).video).toMatchObject({
      layoutPreset: "pipRight",
      transform: { position: { x: 0.87, y: 0.77 }, scale: 0.5, rotation: 0 },
      cutout: { enabled: true, mode: "personAndProps" },
      effects: [
        { id: "grade" },
        { type: "dropShadow", params: { distance: 4, blur: 5, opacity: 60 } },
      ],
    });
    expect(picture(c).keyframes["video.transform.rotation"]).toBeUndefined();
    expect(picture(c).keyframes["video.opacity"]).toHaveLength(1);
    const shadow = (picture(c).video!.effects as { id: string }[])[1]!.id;
    apply(c, { applyLayout: { clipIDs: ["clip"], preset: "pipLeft" } });
    expect((picture(c).video!.effects as { id: string }[])[1]?.id).toBe(shadow);
    expect(picture(c).video?.transform).toMatchObject({ position: { x: 0.13, y: 0.77 } });
    apply(c, { applyLayout: { clipIDs: ["clip"], preset: "full" } });
    expect(picture(c).video).toMatchObject({
      transform: identity(),
      crop: { left: 0, right: 0, top: 0, bottom: 0 },
      cutout: { enabled: false },
      effects: [{ id: "grade" }],
    });
    c.undo();
    expect(picture(c).video?.layoutPreset).toBe("pipLeft");
  });
  it("splits by camera role, fills portrait media, and rolls back locked batches", () => {
    const c = new ProjectCoordinator(fixture());
    apply(c, { applyLayout: { clipIDs: ["clip"], preset: "split" } });
    expect(picture(c).video).toMatchObject({
      transform: { position: { x: 0.75, y: 0.5 }, scale: 1 },
      crop: { left: 0.25, right: 0.25 },
    });
    const f = fixture();
    const portrait = {
      ...f,
      project: {
        ...f.project,
        media: f.project.media.map((m) => ({
          ...m,
          width: 1080,
          height: 1920,
          role: "screen" as const,
        })),
      },
    };
    const p = new ProjectCoordinator(portrait);
    apply(p, { applyLayout: { clipIDs: ["clip"], preset: "fill" } });
    expect((picture(p).video!.transform as { scale: number }).scale).toBeCloseTo(256 / 81);
    apply(p, { applyLayout: { clipIDs: ["clip"], preset: "split" } });
    expect(picture(p).video?.transform).toMatchObject({ position: { x: 0.25 } });
    const locked = new ProjectCoordinator({
      ...f,
      project: {
        ...f.project,
        videoTracks: f.project.videoTracks.map((t) => ({ ...t, locked: true })),
      },
    });
    expect(() => apply(locked, { applyLayout: { clipIDs: ["clip"], preset: "full" } })).toThrow(
      /locked/,
    );
    expect(locked.getSnapshot().revision).toBe(0);
    expect(() =>
      c.apply({
        commands: [
          { applyLayout: { clipIDs: ["clip"], preset: "full" } },
          { addMotion: { clipIDs: ["clip"], style: "zoomIn", amount: 4 } },
        ],
      }),
    ).toThrow(/1 to 3/);
    expect(picture(c).video?.layoutPreset).toBe("split");
  });
  it("zooms a normalized region, keeping rotation and unrelated animation", () => {
    expect(
      regionTransform({ x: 0.5, y: 0.25, width: 0.5, height: 0.5 }, 1920, 1080, 1920, 1080),
    ).toEqual({ position: { x: 0, y: 0.5 }, scale: 2, rotation: 0 });
    const c = new ProjectCoordinator(
      fixture(
        { transform: { rotation: 12 }, layoutPreset: "full" },
        { "video.opacity": [{ time: 0, value: 0.8 }] },
      ),
    );
    apply(c, {
      zoomToRegion: { clipID: "clip", rect: { x: 0.5, y: 0.25, width: 0.5, height: 0.5 } },
    });
    expect(picture(c).video?.transform).toMatchObject({
      rotation: 12,
      scale: 2,
      position: { x: 0, y: 0.5 },
    });
    expect(picture(c).video?.layoutPreset).toBeUndefined();
    expect(picture(c).keyframes["video.opacity"]).toHaveLength(1);
    expect(() =>
      apply(c, { zoomToRegion: { clipID: "clip", rect: { x: 0.8, y: 0, width: 0.5, height: 1 } } }),
    ).toThrow(/rectangle/);
  });
  it("animates zoom from a timeline time with a held lead-in and exact boundaries", () => {
    const c = new ProjectCoordinator(fixture());
    apply(c, {
      zoomToRegion: {
        clipID: "clip",
        rect: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
        at: 6,
        duration: 1,
      },
    });
    const clip = picture(c);
    expect(clip.keyframes["video.transform.scale"]).toEqual([
      { time: 0, value: 1, interpolation: "hold" },
      { time: 1, value: 1, interpolation: "easeInOut" },
      { time: 2, value: 2, interpolation: "easeInOut" },
    ]);
    expect(resolveClip(clip, 5.5).video?.transform).toMatchObject({ scale: 1 });
    expect(resolveClip(clip, 6.5).video?.transform).toMatchObject({ scale: 1.5 });
    expect(resolveClip(clip, 7).video?.transform).toMatchObject({ scale: 2 });
    expect(() =>
      apply(c, {
        zoomToRegion: {
          clipID: "clip",
          rect: { x: 0, y: 0, width: 1, height: 1 },
          at: 8.8,
          duration: 0.5,
        },
      }),
    ).toThrow(/inside/);
    expect(() =>
      apply(c, {
        zoomToRegion: {
          clipID: "clip",
          rect: { x: 0, y: 0, width: 1, height: 1 },
          at: 6,
          duration: 0,
        },
      }),
    ).toThrow(/positive/);
  });
});
describe("keyframe interpolation and editing", () => {
  it("matches every reference ease curve and holds endpoints", () => {
    expect(
      ["linear", "easeIn", "easeOut", "easeInOut", "hold"].map((k) => easing(k as "linear", 0.25)),
    ).toEqual([0.25, 0.015625, 0.578125, 0.0625, 0]);
    const keys = [
      { time: 0, value: 0, interpolation: "linear" },
      { time: 2, value: 10, interpolation: "hold" },
    ];
    expect(keyframeValue(keys, -1)).toBe(0);
    expect(keyframeValue(keys, 1)).toBe(5);
    expect(keyframeValue(keys, 2)).toBe(10);
    expect(keyframeValue(keys, 9)).toBe(10);
    expect(
      keyframeValue(
        [
          { time: 0, value: 0 },
          { time: 1, value: 1 },
        ],
        0.25,
      ),
    ).toBe(0.0625);
    expect(
      keyframeValue(
        [
          { time: 0, value: 1, interpolation: "hold" },
          { time: 1, value: 2 },
        ],
        0.99,
      ),
    ).toBe(1);
    expect(
      keyframeValue(
        [
          { time: 0, value: 1, interpolation: "hold" },
          { time: 1, value: 2 },
        ],
        1,
      ),
    ).toBe(2);
  });
  it("interpolates points/colors while booleans and strings hold", () => {
    expect(interpolate({ x: 0, y: 1 }, { x: 1, y: 0 }, 0.25)).toEqual({ x: 0.25, y: 0.75 });
    expect(interpolate({ r: 0, g: 1, b: 0, a: 0 }, { r: 1, g: 0, b: 1, a: 1 }, 0.5)).toEqual({
      r: 0.5,
      g: 0.5,
      b: 0.5,
      a: 0.5,
    });
    expect(interpolate(false, true, 0.9)).toBe(false);
    expect(interpolate("a", "b", 1)).toBe("b");
    expect(interpolate(350, 10, 0.5, true)).toBe(0);
    expect(interpolate(10, 350, 0.5, true)).toBe(0);
    expect(interpolate(350, 10, 0.5)).toBe(180);
  });
  it("resolves effect hue and sound keys without mutating stored settings", () => {
    const clip = fixture(
      { effects: [{ id: "wheel", type: "colorWheels", params: { shadowsHue: 90, keep: true } }] },
      {
        "video.effects.wheel.shadowsHue": [
          { time: 0, value: 350, interpolation: "linear" },
          { time: 2, value: 10 },
        ],
        "audio.gainDB": [
          { time: 0, value: -10, interpolation: "linear" },
          { time: 2, value: 0 },
        ],
      },
    ).project.videoTracks[0]!.clips[0]!;
    const resolved = resolveClip(clip, 6);
    expect(resolved.video?.effects).toMatchObject([{ params: { shadowsHue: 0, keep: true } }]);
    expect(resolved.audio?.gainDB).toBe(-5);
    expect(clip.video?.effects).toMatchObject([{ params: { shadowsHue: 90 } }]);
  });
  it("sets only one path, sorts keys, clears with an empty array, and replays deterministically", () => {
    const c = new ProjectCoordinator(fixture({}, { "video.opacity": [{ time: 0, value: 0.4 }] }));
    apply(c, {
      setKeyframes: {
        clipID: "clip",
        parameter: "video.transform.scale",
        keyframes: [
          { time: 2, value: 2 },
          { time: 0, value: 1 },
        ],
      },
    });
    expect(picture(c).keyframes["video.transform.scale"]?.map((k) => k.time)).toEqual([0, 2]);
    expect(picture(c).keyframes["video.transform.scale"]?.[0]?.interpolation).toBe("easeInOut");
    expect(framePlan(c.getSnapshot().project, 6).layers[0]?.clip.video?.transform).toMatchObject({
      scale: 1.5,
    });
    expect(
      replayJournal(decodeProjectFile(JSON.parse(encodeProjectFile(c.projectFile())))),
    ).toEqual(c.projectFile());
    apply(c, {
      setKeyframes: { clipID: "clip", parameter: "video.transform.scale", keyframes: [] },
    });
    expect(picture(c).keyframes["video.transform.scale"]).toBeUndefined();
    expect(picture(c).keyframes["video.opacity"]).toHaveLength(1);
    c.undo();
    expect(picture(c).keyframes["video.transform.scale"]).toHaveLength(2);
    const revision = c.getSnapshot().revision;
    expect(() =>
      apply(c, {
        setKeyframes: {
          clipID: "clip",
          parameter: "video.opacity",
          keyframes: [{ time: 0, value: [1] }],
        },
      }),
    ).toThrow();
    expect(c.getSnapshot().revision).toBe(revision);
    expect(
      apply(c, {
        setKeyframes: {
          clipID: "clip",
          parameter: "unknown.path",
          keyframes: [{ time: 0, value: 1 }],
        },
      }).warnings.join(" "),
    ).toMatch(/known animatable/);
    expect(exportPlan(c.getSnapshot().project).duration).toBe(9);
  });
});
describe("motion presets", () => {
  it("generates zoom endpoints and clamps pan travel to available overflow", () => {
    const base = identity();
    expect(motionEnds(base, "zoomIn", 1.12, 1920, 1080, 1920, 1080).map((t) => t.scale)).toEqual([
      1, 1.12,
    ]);
    expect(motionEnds(base, "zoomOut", 1.12, 1920, 1080, 1920, 1080).map((t) => t.scale)).toEqual([
      1.12, 1,
    ]);
    const [start, stop] = motionEnds(base, "panLeft", 1.2, 1920, 1080, 1920, 1080);
    expect(start.scale).toBe(1.2);
    expect(start.position.x).toBeCloseTo(0.58);
    expect(stop.position.x).toBeCloseTo(0.42);
    const [verticalA, verticalB] = motionEnds(
      { ...base, scale: 2 },
      "panUp",
      1.12,
      1920,
      1080,
      1920,
      1080,
    );
    expect(verticalA.scale).toBe(2);
    expect(verticalA.position.y).toBeCloseTo(0.9);
    expect(verticalB.position.y).toBeCloseTo(0.1);
  });
  it("uses the full clip duration, replaces only position/scale, and supports undo", () => {
    for (const style of ["zoomIn", "zoomOut", "panLeft", "panRight", "panUp", "panDown"]) {
      const c = new ProjectCoordinator(fixture({}, { "video.opacity": [{ time: 0, value: 0.5 }] }));
      apply(c, { addMotion: { clipIDs: ["clip"], style } });
      expect(picture(c).keyframes["video.transform.scale"]?.map((k) => k.time)).toEqual([0, 4]);
      expect(
        picture(c).keyframes["video.transform.position"]?.every(
          (k) => k.interpolation === "linear",
        ),
      ).toBe(true);
      expect(picture(c).keyframes["video.opacity"]).toHaveLength(1);
      expect(exportPlan(c.getSnapshot().project).duration).toBe(9);
      c.undo();
      expect(picture(c).keyframes["video.transform.position"]).toBeUndefined();
    }
  });
});
