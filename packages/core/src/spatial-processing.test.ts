import { describe, it, expect } from "vite-plus/test";
import { raster, gaussian, blur, sharpen, pixelate } from "./spatial-processing";
import { layerStyles, pixelScale } from "./layer-styles";
import { effectIssue } from "./color-processing";
import { decodeProjectFile } from "@sidecut/contracts/project";
import type { ClipEffect } from "@sidecut/contracts/project";
import { framePlan, exportPlan } from "./render-plan";
const fx = (type: string, params: ClipEffect["params"] = {}, enabled = true): ClipEffect => ({
  id: type,
  type,
  params,
  enabled,
});
const solid = (w = 21, h = 1, rgba = [0.6, 0.2, 0.1, 1]) => {
  const image = raster(w, h);
  for (let i = 0; i < image.data.length; i += 4) image.data.set(rgba, i);
  return image;
};
const close = (a: ArrayLike<number>, b: ArrayLike<number>, tolerance = 1e-6) => {
  expect(a.length).toBe(b.length);
  for (let i = 0; i < a.length; i++) expect(Math.abs(a[i]! - b[i]!)).toBeLessThanOrEqual(tolerance);
};
describe("spatial kernels", () => {
  it("keeps constant edges opaque for blur and keeps alpha unchanged for sharpen", async () => {
    const input = solid();
    for (const sigma of [0.25, 1, 2, 3, 20, 200])
      close((await blur(input, sigma)).data, input.data);
    const sharpened = await sharpen(input, 10);
    close(sharpened.data, input.data);
    expect(await sharpen(input, 0)).toBe(input);
  });
  it("uses normalized symmetric Gaussian weights for a small-radius impulse", async () => {
    const input = raster(17, 1);
    input.data[8 * 4] = 1;
    input.data[8 * 4 + 3] = 1;
    const out = await gaussian(input, 1);
    const weights = Array.from({ length: 9 }, (_, i) => Math.exp(-((i - 4) ** 2) / 2)),
      sum = weights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < 9; i++) expect(out.data[(i + 4) * 4]).toBeCloseTo(weights[i]! / sum, 6);
  });
  it("keeps the broad Gaussian approximation normalized and symmetric", async () => {
    const input = raster(101, 1);
    input.data[50 * 4 + 3] = 1;
    const out = await gaussian(input, 5);
    let sum = 0;
    for (let x = 0; x < 101; x++) {
      sum += out.data[x * 4 + 3]!;
      expect(out.data[x * 4 + 3]).toBeCloseTo(out.data[(100 - x) * 4 + 3]!, 6);
    }
    expect(sum).toBeCloseTo(1, 6);
    expect(out.data[50 * 4 + 3]).toBeCloseTo(1 / (5 * Math.sqrt(2 * Math.PI)), 2);
  });
  it("bounds the broad-blur approximation against an independently normalized Gaussian", async () => {
    for (const sigma of [3, 5, 20, 100]) {
      const radius = Math.ceil(4 * sigma),
        width = radius * 2 + 1,
        input = raster(width, 1);
      input.data[radius * 4 + 3] = 1;
      const actual = await gaussian(input, sigma, false),
        weights = Array.from({ length: width }, (_, i) =>
          Math.exp(-((i - radius) ** 2) / (2 * sigma * sigma)),
        ),
        sum = weights.reduce((a, b) => a + b, 0);
      // A one-row transparent-outside image loses alpha in the vertical pass as well.
      const row = solid(width, 1, [0, 0, 0, 0]);
      row.data[radius * 4 + 3] = 1;
      const extended = await gaussian(row, sigma, true);
      let maximum = 0;
      for (let x = 0; x < width; x++)
        maximum = Math.max(maximum, Math.abs(extended.data[x * 4 + 3]! - weights[x]! / sum));
      expect(maximum).toBeLessThan(0.015);
      expect(actual.data.every(Number.isFinite)).toBe(true);
    }
  });
  it("blurs premultiplied alpha without black fringes or leaked hidden colors", async () => {
    const input = solid(9, 1, [0, 1, 0, 0]);
    input.data.set([1, 0, 0, 1], 4 * 4);
    const out = await blur(input, 1);
    expect(out.data[3 * 4 + 3]).toBeGreaterThan(0);
    close(out.data.slice(3 * 4, 3 * 4 + 3), [1, 0, 0]);
  });
  it("extends edges for source blur and uses transparent outside pixels for shadows", async () => {
    const input = solid(9, 9, [0, 0, 0, 1]);
    const source = await gaussian(input, 1, true),
      shadow = await gaussian(input, 1, false);
    expect(source.data[3]).toBeCloseTo(1, 6);
    expect(shadow.data[3]).toBeLessThan(0.6);
    expect(shadow.data[3]).toBeGreaterThan(0.4);
  });
  it("sharpens luminance around an edge while preserving channel differences and alpha", async () => {
    const input = solid(17, 1, [0.2, 0.3, 0.4, 0.7]);
    for (let x = 8; x < 17; x++) input.data.set([0.6, 0.7, 0.8, 0.7], x * 4);
    const out = await sharpen(input, 10);
    expect(out.data[7 * 4]).toBeLessThan(input.data[7 * 4]!);
    expect(out.data[8 * 4]).toBeGreaterThan(input.data[8 * 4]!);
    for (let x = 0; x < 17; x++) {
      expect(out.data[x * 4 + 3]).toBe(input.data[x * 4 + 3]);
      expect(out.data[x * 4 + 1]! - out.data[x * 4]!).toBeCloseTo(0.1, 6);
    }
  });
  it("aligns pixelation to the reference center and converts y-up source coordinates", () => {
    const input = raster(12, 12);
    for (let y = 0; y < 12; y++)
      for (let x = 0; x < 12; x++) input.data.set([x / 12, y / 12, 0, 1], (y * 12 + x) * 4);
    const out = pixelate(input, 4);
    // Center 150 has cell boundaries at x=2,6,10. Core Image's y center maps to -138.
    close(out.data.slice((3 * 12 + 2) * 4, (3 * 12 + 2) * 4 + 4), [3.5 / 12, 3.5 / 12, 0, 1]);
    close(out.data.slice((5 * 12 + 5) * 4, (5 * 12 + 5) * 4 + 4), [3.5 / 12, 3.5 / 12, 0, 1]);
    expect(out.data[(3 * 12 + 6) * 4]).toBeCloseTo(7.5 / 12, 6);
    expect(pixelate(input, 1)).toBe(input);
  });
  it("interpolates pixelation samples with premultiplied alpha", () => {
    const input = solid(8, 1, [0, 1, 0, 0]);
    input.data.set([1, 0, 0, 1], 3 * 4);
    const out = pixelate(input, 4);
    close(out.data.slice(2 * 4, 2 * 4 + 4), [1, 0, 0, 0.5]);
  });
  it("observes cancellation and browser-supplied scheduling between passes", async () => {
    let yielded = 0;
    const input = solid(8, 8);
    await gaussian(input, 5, true, {
      throwIfAborted() {},
      async yield() {
        yielded++;
      },
    });
    expect(yielded).toBe(6);
    await expect(
      blur(input, 2, {
        throwIfAborted() {
          throw new Error("cancelled");
        },
      }),
    ).rejects.toThrow("cancelled");
  });
});
describe("fixed style pipeline", () => {
  it("uses the first enabled style per type with registry defaults", () => {
    const plan = layerStyles(
      [
        fx("border", { width: 99 }, false),
        fx("border", { width: 4 }),
        fx("border", { width: 12 }),
        fx("roundedCorners"),
        fx("dropShadow"),
      ],
      1920,
      1080,
    );
    expect(plan.border).toBe(4);
    expect(plan.borderColor).toEqual([1, 1, 1, 1]);
    expect(plan.radius).toBe(24);
    expect(plan.shadow.dx).toBeCloseTo(4 / Math.sqrt(2));
    expect(plan.shadow.dy).toBeCloseTo(4 / Math.sqrt(2));
    expect(plan.shadow.blur).toBe(5);
    expect(plan.shadow.opacity).toBe(0.6);
  });
  it("scales sizes with output short side for landscape, portrait and preview", () => {
    expect(pixelScale(3840, 2160)).toBe(2);
    expect(pixelScale(1080, 1920)).toBe(1);
    for (const size of [
      [1920, 1080],
      [960, 540],
    ] as const) {
      const p = layerStyles(
        [fx("border", { width: 8 }), fx("roundedCorners", { radius: 20 })],
        size[0],
        size[1],
      );
      expect(p.border).toBe((8 * size[1]) / 1080);
      expect(p.radius).toBe((20 * size[1]) / 1080);
    }
  });
  it("uses light direction, independent shadow color alpha, and disabled identities", () => {
    const p = layerStyles(
      [
        fx("dropShadow", {
          angle: 0,
          distance: 12,
          opacity: 50,
          color: { r: 1, g: 0, b: 0, a: 0.25 },
        }),
      ],
      1920,
      1080,
    );
    expect(p.shadow.dx).toBe(-12);
    expect(p.shadow.dy).toBe(0);
    expect(p.shadow.opacity * p.shadow.color[3]).toBe(0.125);
    const empty = layerStyles(
      [fx("border", {}, false), fx("roundedCorners", {}, false), fx("dropShadow", {}, false)],
      1920,
      1080,
    );
    expect([empty.border, empty.radius, empty.shadow.opacity]).toEqual([0, 0, 0]);
  });
  it("accepts all six renderers and evaluates spatial/style animation in frame plans", () => {
    const effects = ["sharpen", "blur", "pixelate", "dropShadow", "border", "roundedCorners"].map(
      (type) => fx(type),
    );
    expect(effectIssue(effects)).toBeNull();
    const file = decodeProjectFile({
      revision: 0,
      project: {
        settings: { width: 320, height: 180 },
        videoTracks: [
          {
            id: "t",
            kind: "video",
            clips: [
              {
                id: "c",
                duration: 1,
                content: { solid: { color: { r: 1, g: 0, b: 0, a: 1 } } },
                video: { effects },
                keyframes: {
                  "video.effects.blur.radius": [
                    { time: 0, value: 0, interpolation: "linear" },
                    { time: 1, value: 20 },
                  ],
                },
              },
            ],
          },
        ],
      },
    });
    expect(exportPlan(file.project).frameCount).toBe(30);
    expect(
      (framePlan(file.project, 0.5).layers[0]!.clip.video!.effects as ClipEffect[]).find(
        (f) => f.type === "blur",
      )!.params.radius,
    ).toBe(10);
  });
});
