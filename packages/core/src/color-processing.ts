// Formula ports from TandemRender/Kernels.swift and ColourWheelGrade.swift.
// Upstream notice: tests/fixtures/tandem/TANDEM-LICENSE.
import type { ClipEffect } from "@sidecut/contracts/project";
import type { CubeLUT } from "./cube-lut";
import { sampleCube } from "./cube-lut";
import { resolvedParams, renderedEffects, effectDefinition } from "./effects";
export type RGB = [number, number, number];
export const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const luma = (x: readonly number[]) => x[0]! * 0.2126 + x[1]! * 0.7152 + x[2]! * 0.0722;
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
export function hueRGB(degrees: number): RGB {
  const h = (((degrees % 360) + 360) % 360) / 60,
    x = 1 - Math.abs((h % 2) - 1);
  return h < 1
    ? [1, x, 0]
    : h < 2
      ? [x, 1, 0]
      : h < 3
        ? [0, 1, x]
        : h < 4
          ? [0, x, 1]
          : h < 5
            ? [x, 0, 1]
            : [1, 0, x];
}
export function wheelDirection(hue: number): RGB {
  const rgb = hueRGB(hue),
    y = luma(rgb),
    cb = (rgb[2] - y) / 1.8556,
    cr = (rgb[0] - y) / 1.5748,
    length = Math.hypot(cb, cr);
  const r = (1.5748 * cr) / length,
    b = (1.8556 * cb) / length;
  return [r, -(0.2126 * r + 0.0722 * b) / 0.7152, b];
}
export function rgbHSL(rgb: readonly number[]): RGB {
  const [r, g, b] = rgb as RGB,
    high = Math.max(r, g, b),
    low = Math.min(r, g, b),
    l = (high + low) / 2,
    d = high - low;
  if (d < 1e-6) return [0, 0, l];
  const s = l > 0.5 ? d / (2 - high - low) : d / (high + low);
  const h =
    high === r ? (g - b) / d + (g < b ? 6 : 0) : high === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}
export function hslRGB([h, s, l]: readonly number[]): RGB {
  if (s! < 1e-6) return [l!, l!, l!];
  const q = l! < 0.5 ? l! * (1 + s!) : l! + s! - l! * s!,
    p = 2 * l! - q;
  const hue = (v: number) => {
    v = ((v % 1) + 1) % 1;
    return v < 1 / 6
      ? p + (q - p) * 6 * v
      : v < 0.5
        ? q
        : v < 2 / 3
          ? p + (q - p) * (2 / 3 - v) * 6
          : p;
  };
  return [hue(h! + 1 / 3), hue(h!), hue(h! - 1 / 3)];
}
export type PixelEffect = (rgb: RGB, u: number, v: number) => RGB;
export function compileEffect(effect: ClipEffect, lut?: CubeLUT): PixelEffect {
  const params = resolvedParams(effect);
  const numbers: Record<string, number> = Object.fromEntries(
    (effectDefinition(effect.type)?.params ?? [])
      .filter((p) => typeof p.defaultValue === "number")
      .map((p) => [p.key, p.defaultValue as number]),
  );
  for (const [key, value] of Object.entries(params))
    if (typeof value === "number") numbers[key] = value;
  const n = (key: string) => numbers[key] ?? 0;
  switch (effect.type) {
    case "colorAdjust":
      return (input) => {
        let x: RGB = [...input];
        if (n("exposure") !== 0)
          x = x.map((v) => (Math.max(v, 0) ** 2.2 * 2 ** n("exposure")) ** (1 / 2.2)) as RGB;
        const black = (-n("blackLevel") / 100) * 0.1;
        x = x.map(
          (v) => ((v - black) / (1 - black) - 0.5) * (1 + (n("contrast") / 100) * 0.5) + 0.5,
        ) as RGB;
        let l = luma(x);
        const shift =
          (n("highlights") / 100) * 0.25 * smooth(0.5, 1, l) +
          (n("shadows") / 100) * 0.25 * (1 - smooth(0, 0.5, l));
        x = x.map((v) => v + shift) as RGB;
        l = luma(x);
        const chroma = clamp01(Math.max(...x) - Math.min(...x)),
          saturation = (1 + n("saturation") / 100) * (1 + (n("vibrance") / 100) * (1 - chroma));
        const temperature = n("temperature") / 100,
          tint = n("tint") / 100;
        return x.map((v, i) =>
          clamp01(
            mix(l, v, saturation) *
              [
                1 + 0.1 * temperature + 0.05 * tint,
                1 - 0.1 * tint,
                1 - 0.1 * temperature + 0.05 * tint,
              ][i]!,
          ),
        ) as RGB;
      };
    case "hsl": {
      const centers = [0, 30, 60, 120, 180, 240, 270, 300, 360],
        colors = ["red", "orange", "yellow", "green", "aqua", "blue", "purple", "magenta"];
      return (input) => {
        let [h, s, l] = rgbHSL(input.map(clamp01));
        const degrees = h * 360;
        let i = 0;
        for (let k = 1; k < 8; k++) if (degrees >= centers[k]!) i = k;
        const j = (i + 1) % 8,
          t = clamp01((degrees - centers[i]!) / (centers[i + 1]! - centers[i]!)),
          weight = smooth(0.02, 0.2, s);
        const delta = (suffix: string) =>
          (mix(n(colors[i] + suffix), n(colors[j] + suffix), t) / 100) * weight;
        h = (((h + delta("Hue") / 12) % 1) + 1) % 1;
        s = clamp01(s * (1 + delta("Saturation")));
        l = clamp01(l + delta("Luminance") * 0.2);
        return hslRGB([h, s, l]);
      };
    }
    case "colorWheels": {
      const wheel = (name: string, scale: number, bias: number, brightness: number) => {
        const direction = wheelDirection(n(name + "Hue")),
          amount = n(name + "Amount") / 100;
        return direction.map(
          (v) => v * amount * scale + bias + (n(name + "Brightness") / 100) * brightness,
        ) as RGB;
      };
      const lift = wheel("shadows", 0.1, 0, 0.15),
        gain = wheel("highlights", 0.1, 1, 0.25),
        power = wheel("midtones", 0.2, 0, 0.5).map((v) => 2 ** -v);
      return (rgb) =>
        rgb.map((x, i) => {
          const y = (x + lift[i]! * (1 - x)) * gain[i]!;
          return power[i] === 1 ? y : Math.sign(y) * Math.abs(y) ** power[i]!;
        }) as RGB;
    }
    case "vignette": {
      const inner = 0.4 + (0.6 * n("size")) / 100,
        feather = 0.05 + (0.46 * n("feather")) / 100,
        amount = n("amount") / 100;
      return (rgb, u, v) => {
        const distance = Math.hypot((u - 0.5) * 2, (v - 0.5) * 2) / Math.SQRT2;
        const t = smooth(0, 1, clamp01((distance - inner) / feather));
        return rgb.map((x) =>
          amount < 0 ? x * (1 + amount * t) : x + (1 - x) * amount * t,
        ) as RGB;
      };
    }
    case "lut": {
      const intensity = clamp01(n("intensity"));
      if (!intensity) return (rgb) => rgb;
      if (!lut)
        throw new Error(
          `LUT "${String(params.path ?? "")}" is missing. Import its .cube file on this device.`,
        );
      return (rgb) => sampleCube(lut, rgb).map((v, i) => mix(rgb[i]!, v, intensity)) as RGB;
    }
    default:
      throw new Error(
        `Effect "${effect.type}" has no browser renderer yet. Disable or remove it to render.`,
      );
  }
}
export function effectIssue(effects: readonly ClipEffect[]): string | null {
  for (const fx of effects) {
    if (fx.enabled === false) continue;
    if (!renderedEffects.has(fx.type))
      return `Effect "${fx.type}" has no browser renderer yet. Disable or remove it to render.`;
    if (fx.type === "lut" && Number(resolvedParams(fx).intensity) !== 0 && !resolvedParams(fx).path)
      return "Choose and import a .cube file for the LUT effect before rendering.";
  }
  return null;
}
