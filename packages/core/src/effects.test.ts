import { describe, it, expect } from "vite-plus/test";
import { decodeProjectFile, encodeProjectFile } from "@sidecut/contracts/project";
import type { ClipEffect } from "@sidecut/contracts/project";
import { ProjectCoordinator, replayJournal } from "./coordinator";
import { effectsOf } from "./effect-editing";
import { effectRegistry, resolvedParams } from "./effects";
import { compileEffect, wheelDirection, hslRGB } from "./color-processing";
import { parseCube, sampleCube } from "./cube-lut";
import { resolveClip } from "./keyframes";
import { previewIssue } from "./render-plan";
import { validateProject } from "./validation";
const fx = (type: string, params: Record<string, number | string> = {}): ClipEffect => ({
  id: "fx",
  type,
  enabled: true,
  params,
});
const file = () =>
  decodeProjectFile({
    revision: 0,
    project: {
      id: "effects",
      settings: { width: 320, height: 180 },
      media: [{ id: "audioMedia", path: "test.wav", kind: "audio", duration: 1 }],
      videoTracks: [
        {
          id: "video",
          kind: "video",
          clips: [
            {
              id: "clip",
              duration: 1,
              content: { solid: { color: { r: 0.5, g: 0.4, b: 0.3, a: 1 } } },
            },
          ],
        },
      ],
      audioTracks: [
        {
          id: "audio",
          kind: "audio",
          clips: [{ id: "sound", duration: 1, content: { media: { mediaID: "audioMedia" } } }],
        },
      ],
    },
  });
const clip = (c: ProjectCoordinator) => c.getSnapshot().project.videoTracks[0]!.clips[0]!;
const apply = (c: ProjectCoordinator, command: unknown) => c.apply({ commands: [command] });
const close = (actual: readonly number[], expected: readonly number[], digits = 10) =>
  actual.forEach((v, i) => expect(v).toBeCloseTo(expected[i]!, digits));
const cube = "LUT_3D_SIZE 2\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1";
describe("effect stack commands", () => {
  it("assigns deterministic IDs, preserves defaults, order, enabled state, unknown fields and journal replay", () => {
    const c = new ProjectCoordinator(file());
    const result = apply(c, { addEffect: { clipID: "clip", effect: { type: "vignette" } } });
    const id = result.createdIDs[0]!;
    expect(id).toBeTruthy();
    expect(effectsOf(clip(c), "video")[0]).toMatchObject({ id, enabled: true, params: {} });
    apply(c, {
      addEffect: {
        clipID: "clip",
        effect: { id: "future", type: "custom", params: { keep: 7 } },
        index: 0,
      },
    });
    apply(c, {
      updateEffect: {
        clipID: "clip",
        effectID: "future",
        patch: { enabled: false, metadata: { keep: true } },
      },
    });
    apply(c, { moveEffect: { clipID: "clip", effectID: "future", index: 100 } });
    const reopened = decodeProjectFile(JSON.parse(encodeProjectFile(c.projectFile())));
    expect(effectsOf(reopened.project.videoTracks[0]!.clips[0]!, "video").map((f) => f.id)).toEqual(
      [id, "future"],
    );
    expect(validateProject(reopened.project)).toContainEqual(
      expect.objectContaining({ severity: "warning", code: "unknown-effect" }),
    );
    expect(resolvedParams(effectsOf(clip(c), "video")[0]!).amount).toBe(-30);
    expect(replayJournal(c.projectFile()).project).toEqual(c.getSnapshot().project);
    c.undo();
    expect(effectsOf(clip(c), "video")[0]!.id).toBe("future");
    c.redo();
    expect(effectsOf(clip(c), "video")[1]!.enabled).toBe(false);
  });
  it("merges and deletes params, removes only the selected effect's keys, and undoes removal", () => {
    const c = new ProjectCoordinator(file());
    apply(c, {
      addEffect: {
        clipID: "clip",
        effect: { id: "fx", type: "colorAdjust", params: { contrast: 30, temperature: 10 } },
      },
    });
    apply(c, {
      updateEffect: {
        clipID: "clip",
        effectID: "fx",
        patch: { params: { contrast: null, saturation: 20 } },
      },
    });
    expect(effectsOf(clip(c), "video")[0]!.params).toEqual({ temperature: 10, saturation: 20 });
    c.apply({
      commands: [
        {
          setKeyframes: {
            clipID: "clip",
            parameter: "video.effects.fx.exposure",
            keyframes: [{ time: 0, value: 1 }],
          },
        },
        {
          setKeyframes: {
            clipID: "clip",
            parameter: "video.opacity",
            keyframes: [{ time: 0, value: 0.5 }],
          },
        },
      ],
    });
    apply(c, { removeEffect: { clipID: "clip", effectID: "fx" } });
    expect(clip(c).keyframes["video.effects.fx.exposure"]).toBeUndefined();
    expect(clip(c).keyframes["video.opacity"]).toHaveLength(1);
    c.undo();
    expect(clip(c).keyframes["video.effects.fx.exposure"]).toHaveLength(1);
  });
  it("rejects duplicate IDs, domain mismatches, ID patches and locked tracks atomically", () => {
    const c = new ProjectCoordinator(file());
    apply(c, { addEffect: { clipID: "clip", effect: { id: "fx", type: "hsl" } } });
    for (const command of [
      { addEffect: { clipID: "clip", effect: { id: "fx", type: "lut" } } },
      { addEffect: { clipID: "clip", effect: { type: "pitchShift" } } },
      { updateEffect: { clipID: "clip", effectID: "fx", patch: { id: "other" } } },
    ]) {
      const before = c.getSnapshot();
      expect(() =>
        c.apply({ commands: [{ updateProject: { patch: { name: "bad" } } }, command] }),
      ).toThrow();
      expect(c.getSnapshot()).toBe(before);
    }
    apply(c, { updateTrack: { trackID: "video", patch: { locked: true } } });
    expect(() => apply(c, { removeEffect: { clipID: "clip", effectID: "fx" } })).toThrow(/locked/);
  });
  it("stores audio effects in audio properties and rejects pending enabled renderers", () => {
    const c = new ProjectCoordinator(file());
    apply(c, { addEffect: { clipID: "sound", effect: { type: "compressor" } } });
    expect(c.getSnapshot().project.audioTracks[0]!.clips[0]!.audio?.effects).toHaveLength(1);
    apply(c, { addEffect: { clipID: "clip", effect: { id: "x", type: "unknown" } } });
    expect(previewIssue(c.getSnapshot().project, 0)).toMatch(/unknown/);
  });
});
describe("reference color formula cases", () => {
  it("contains all 15 definitions and exact defaults/ranges", () => {
    expect(effectRegistry).toHaveLength(15);
    expect(effectRegistry.find((d) => d.type === "hsl")!.params).toHaveLength(24);
    expect(effectRegistry.find((d) => d.type === "colorWheels")!.params).toHaveLength(9);
    expect(effectRegistry.find((d) => d.type === "colorAdjust")!.params[0]).toMatchObject({
      defaultValue: 0,
      min: -3,
      max: 3,
    });
  });
  it("uses numeric registry defaults for parameters stored with the wrong type", () => {
    expect(resolvedParams(fx("lut", { intensity: "0" })).intensity).toBe(1);
    close(
      compileEffect(fx("colorAdjust", { exposure: "3" }))([0.2, 0.4, 0.6], 0, 0),
      [0.2, 0.4, 0.6],
    );
  });
  it("keeps neutral adjustments, HSL and wheels unchanged", () => {
    for (const type of ["colorAdjust", "hsl", "colorWheels"])
      for (const rgb of [
        [0, 0, 0],
        [1, 1, 1],
        [0.2, 0.7, 0.4],
      ] as [number, number, number][])
        close(compileEffect(fx(type))(rgb, 0.5, 0.5), rgb);
  });
  it("matches exposure, contrast, white balance and desaturation patches", () => {
    close(
      compileEffect(fx("colorAdjust", { exposure: 1 }))([0.25, 0.5, 0.75], 0, 0),
      [0.25, 0.5, 0.75].map((v) => Math.min(1, v * 2 ** (1 / 2.2))),
    );
    close(
      compileEffect(fx("colorAdjust", { contrast: 100 }))([0.25, 0.5, 0.75], 0, 0),
      [0.125, 0.5, 0.875],
    );
    close(
      compileEffect(fx("colorAdjust", { temperature: 100, tint: 100 }))([0.5, 0.5, 0.5], 0, 0),
      [0.575, 0.45, 0.475],
    );
    close(
      compileEffect(fx("colorAdjust", { saturation: -100 }))([1, 0, 0], 0, 0),
      [0.2126, 0.2126, 0.2126],
    );
  });
  it("interpolates HSL boundaries, wraps red, and leaves gray unchanged", () => {
    close(compileEffect(fx("hsl", { redHue: 100 }))([1, 0, 0], 0, 0), [1, 0.5, 0]);
    close(
      compileEffect(fx("hsl", { redHue: 100, orangeHue: 0 }))(hslRGB([15 / 360, 1, 0.5]), 0, 0),
      hslRGB([30 / 360, 1, 0.5]),
    );
    close(
      compileEffect(fx("hsl", { redLuminance: 100, redSaturation: 100 }))([0.4, 0.4, 0.4], 0, 0),
      [0.4, 0.4, 0.4],
    );
  });
  it("matches lift, gamma and gain without premature clipping", () => {
    close(
      compileEffect(fx("colorWheels", { shadowsBrightness: 100 }))([0, 0.5, 1], 0, 0),
      [0.15, 0.575, 1],
    );
    close(
      compileEffect(fx("colorWheels", { midtonesBrightness: 100 }))([0.25, 0.5, 1], 0, 0),
      [0.25, 0.5, 1].map((v) => v ** (2 ** -0.5)),
    );
    close(
      compileEffect(fx("colorWheels", { highlightsBrightness: 100 }))([0.2, 0.8, 1], 0, 0),
      [0.25, 1, 1.25],
    );
    const direction = wheelDirection(0);
    expect(direction[0] * 0.2126 + direction[1] * 0.7152 + direction[2] * 0.0722).toBeCloseTo(
      0,
      12,
    );
    expect(
      compileEffect(fx("colorWheels", { shadowsHue: 0, shadowsAmount: 100 }))([0, 0, 0], 0, 0)[1],
    ).toBeLessThan(0);
  });
  it("interpolates wheel hue over the shortest arc using existing keyframes", () => {
    const c = new ProjectCoordinator(file());
    apply(c, { addEffect: { clipID: "clip", effect: { id: "fx", type: "colorWheels" } } });
    apply(c, {
      setKeyframes: {
        clipID: "clip",
        parameter: "video.effects.fx.shadowsHue",
        keyframes: [
          { time: 0, value: 350, interpolation: "linear" },
          { time: 1, value: 10 },
        ],
      },
    });
    expect(resolvedParams(effectsOf(resolveClip(clip(c), 0.5), "video")[0]!).shadowsHue).toBe(0);
  });
  it("matches vignette center, midpoint and corner falloff", () => {
    const effect = compileEffect(fx("vignette", { amount: -100, size: 0, feather: 100 }));
    close(effect([0.8, 0.4, 0.2], 0.5, 0.5), [0.8, 0.4, 0.2]);
    close(effect([0.8, 0.4, 0.2], 0, 0), [0, 0, 0]);
    const u = 0.5 + (0.4 + 0.51 / 2) / Math.SQRT2;
    close(effect([0.8, 0.4, 0.2], u, 0.5), [0.4, 0.2, 0.1]);
    close(compileEffect(fx("vignette", { amount: 100, size: 0 }))([0, 0.5, 1], 0, 0), [1, 1, 1]);
  });
  it("shows ordered noncommutative processing and explicit missing-LUT errors", () => {
    const a = compileEffect(fx("colorAdjust", { exposure: 3 })),
      b = compileEffect(fx("colorAdjust", { exposure: -3 }));
    expect(b(a([0.9, 0.9, 0.9], 0, 0), 0, 0)[0]).toBeLessThan(a(b([0.9, 0.9, 0.9], 0, 0), 0, 0)[0]);
    expect(() => compileEffect(fx("lut", { path: "missing.cube" }))).toThrow(/missing/);
    close(compileEffect(fx("lut", { intensity: 0 }))([0.1, 0.2, 0.3], 0, 0), [0.1, 0.2, 0.3]);
  });
});
describe("cube LUTs", () => {
  it("samples identity with red-fastest trilinear ordering and domains", () => {
    close(sampleCube(parseCube(cube), [0.12, 0.34, 0.56]), [0.12, 0.34, 0.56]);
    close(
      sampleCube(parseCube("DOMAIN_MIN -1 -1 -1\nDOMAIN_MAX 1 1 1\n" + cube), [0, 1, -1]),
      [0.5, 1, 0],
    );
  });
  it("expands a 1D table, preserves title and applies intensity", () => {
    const lut = parseCube('TITLE "invert"\nLUT_1D_SIZE 2\n1 1 1\n0 0 0');
    expect(lut.title).toBe("invert");
    expect(lut.dimension).toBe(33);
    close(sampleCube(lut, [0.1, 0.2, 0.3]), [0.9, 0.8, 0.7]);
    close(
      compileEffect(fx("lut", { intensity: 0.25 }), lut)([0, 0.4, 1], 0, 0),
      [0.25, 0.45, 0.75],
    );
  });
  it("rejects malformed dimensions, domains, tables, combined LUTs and nonfinite entries", () => {
    for (const text of [
      "",
      cube.replace("SIZE 2", "SIZE 129"),
      cube.replace("SIZE 2", "SIZE 2.5"),
      "DOMAIN_MIN 1 0 0\n" + cube,
      cube + "\n0 0 0",
      cube.replace("1 1 1", "NaN 1 1"),
      "LUT_1D_SIZE 2\n" + cube,
    ])
      expect(() => parseCube(text)).toThrow();
  });
});
