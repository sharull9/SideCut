// Browser equivalents of TandemRender/Effects.swift's Core Image bindings.
// Upstream wrapper notice: tests/fixtures/tandem/TANDEM-LICENSE.
// Core Image kernels are proprietary; numeric and kernel limits are recorded in the verification report.
export interface RasterWork {
  throwIfAborted(): void;
  yield?: () => Promise<void>;
}
export interface Raster {
  width: number;
  height: number;
  data: Float32Array;
}
export const raster = (width: number, height: number): Raster => ({
  width,
  height,
  data: new Float32Array(width * height * 4),
});
const clamp = (n: number, max: number) => Math.max(0, Math.min(max, n));
const pause = async (signal?: RasterWork) => {
  signal?.throwIfAborted();
  await signal?.yield?.();
  signal?.throwIfAborted();
};
// Three box convolutions approximate a Gaussian in linear time, with explicit edge extension.
export async function gaussian(
  input: Raster,
  sigma: number,
  extend = true,
  signal?: RasterWork,
): Promise<Raster> {
  if (sigma <= 0) return input;
  if (sigma <= 2) {
    const radius = Math.ceil(sigma * 4),
      weights = Array.from({ length: radius * 2 + 1 }, (_, i) =>
        Math.exp(-((i - radius) ** 2) / (2 * sigma * sigma)),
      ),
      sum = weights.reduce((a, b) => a + b, 0);
    let current = input;
    for (const vertical of [false, true]) {
      await pause(signal);
      const out = raster(input.width, input.height);
      for (let y = 0; y < input.height; y++) {
        if (y % 128 === 0) signal?.throwIfAborted();
        for (let x = 0; x < input.width; x++)
          for (let c = 0; c < 4; c++) {
            let value = 0;
            for (let k = -radius; k <= radius; k++) {
              const sx = vertical ? x : x + k,
                sy = vertical ? y + k : y;
              if (!extend && (sx < 0 || sy < 0 || sx >= input.width || sy >= input.height))
                continue;
              value +=
                (current.data[
                  (clamp(sy, input.height - 1) * input.width + clamp(sx, input.width - 1)) * 4 + c
                ]! *
                  weights[k + radius]!) /
                sum;
            }
            out.data[(y * input.width + x) * 4 + c] = value;
          }
      }
      current = out;
    }
    return current;
  }
  const ideal = Math.sqrt(4 * sigma * sigma + 1),
    floor = Math.floor(ideal),
    lower = Math.max(1, floor % 2 ? floor : floor - 1),
    upper = lower + 2;
  const count = Math.round(
    (12 * sigma * sigma - 3 * lower * lower - 12 * lower - 9) / (-4 * lower - 4),
  );
  let current = input;
  for (let pass = 0; pass < 3; pass++) {
    const radius = Math.max(0, ((pass < count ? lower : upper) - 1) / 2);
    if (!radius) continue;
    for (const vertical of [false, true]) {
      await pause(signal);
      const out = raster(input.width, input.height),
        length = vertical ? input.height : input.width,
        lines = vertical ? input.width : input.height;
      const at = (line: number, p: number) =>
        vertical ? (p * input.width + line) * 4 : (line * input.width + p) * 4;
      const sample = (line: number, p: number, c: number) =>
        !extend && (p < 0 || p >= length) ? 0 : current.data[at(line, clamp(p, length - 1)) + c]!;
      for (let line = 0; line < lines; line++) {
        if (line % 128 === 0) signal?.throwIfAborted();
        for (let c = 0; c < 4; c++) {
          let sum = 0;
          // Sum the interior and repeated edge samples without a radius-sized loop.
          for (let p = 0; p <= Math.min(radius, length - 1); p++) sum += sample(line, p, c);
          if (extend)
            sum +=
              radius * sample(line, 0, c) +
              Math.max(0, radius - length + 1) * sample(line, length - 1, c);
          for (let p = 0; p < length; p++) {
            out.data[at(line, p) + c] = sum / (2 * radius + 1);
            sum += sample(line, p + radius + 1, c) - sample(line, p - radius, c);
          }
        }
      }
      current = out;
    }
  }
  return current;
}
export async function blur(input: Raster, sigma: number, signal?: RasterWork): Promise<Raster> {
  if (sigma <= 0) return input;
  const premult = raster(input.width, input.height);
  for (let i = 0; i < input.data.length; i += 4) {
    const a = input.data[i + 3]!;
    for (let c = 0; c < 3; c++) premult.data[i + c] = input.data[i + c]! * a;
    premult.data[i + 3] = a;
  }
  const out = await gaussian(premult, sigma, true, signal);
  for (let i = 0; i < out.data.length; i += 4) {
    const a = out.data[i + 3]!;
    for (let c = 0; c < 3; c++) out.data[i + c] = a > 1e-8 ? out.data[i + c]! / a : 0;
  }
  return out;
}
export async function sharpen(input: Raster, amount: number, signal?: RasterWork): Promise<Raster> {
  if (amount <= 0) return input;
  const low = await blur(input, 1.69 * Math.max(1, input.height / 1080), signal),
    out = raster(input.width, input.height);
  for (let i = 0; i < input.data.length; i += 4) {
    const delta =
      (((input.data[i]! - low.data[i]!) * 0.2126 +
        (input.data[i + 1]! - low.data[i + 1]!) * 0.7152 +
        (input.data[i + 2]! - low.data[i + 2]!) * 0.0722) *
        amount) /
      10;
    for (let c = 0; c < 3; c++) out.data[i + c] = input.data[i + c]! + delta;
    out.data[i + 3] = input.data[i + 3]!;
  }
  return out;
}
// Core Image's default center is (150,150) in source pixels with y pointing up.
export function pixelate(input: Raster, scale: number, signal?: RasterWork): Raster {
  if (scale <= 1) return input;
  const out = raster(input.width, input.height);
  const center = (p: number) => 150 + (Math.floor((p - 150) / scale) + 0.5) * scale;
  for (let y = 0; y < input.height; y++) {
    if (y % 128 === 0) signal?.throwIfAborted();
    const sy = clamp(input.height - center(input.height - y - 0.5) - 0.5, input.height - 1),
      y0 = Math.floor(sy),
      fy = sy - y0;
    for (let x = 0; x < input.width; x++) {
      const sx = clamp(center(x + 0.5) - 0.5, input.width - 1),
        x0 = Math.floor(sx),
        fx = sx - x0;
      const values = [0, 0, 0, 0];
      for (let dy = 0; dy < 2; dy++)
        for (let dx = 0; dx < 2; dx++) {
          const i =
              (clamp(y0 + dy, input.height - 1) * input.width + clamp(x0 + dx, input.width - 1)) *
              4,
            w = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy),
            a = input.data[i + 3]!;
          for (let c = 0; c < 3; c++) values[c]! += input.data[i + c]! * a * w;
          values[3]! += a * w;
        }
      const i = (y * input.width + x) * 4;
      for (let c = 0; c < 3; c++) out.data[i + c] = values[3]! > 1e-8 ? values[c]! / values[3]! : 0;
      out.data[i + 3] = values[3]!;
    }
  }
  return out;
}
