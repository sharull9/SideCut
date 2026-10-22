import type { ClipEffect } from "@sidecut/contracts/project";
import type { CubeLUT } from "@sidecut/core/cube-lut";
import { compileEffect } from "@sidecut/core/color-processing";
import type { RGB } from "@sidecut/core/color-processing";
import type { Raster } from "@sidecut/core/spatial-processing";
import { blur, sharpen, pixelate } from "@sidecut/core/spatial-processing";
import { resolvedParams, styleEffects } from "@sidecut/core/effects";
export async function processPicture(
  source: CanvasImageSource,
  width: number,
  height: number,
  effects: readonly ClipEffect[],
  lut: ((path: string) => Promise<CubeLUT>) | undefined,
  signal?: AbortSignal,
  pixelsPerUnit = 1,
): Promise<CanvasImageSource> {
  const work = {
    throwIfAborted: () => signal?.throwIfAborted(),
    yield: () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
  };
  const enabled = effects.filter((fx) => fx.enabled !== false && !styleEffects.has(fx.type));
  if (!enabled.length) return source;
  signal?.throwIfAborted();
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas color processing is unavailable.");
  ctx.drawImage(source, 0, 0);
  const image = ctx.getImageData(0, 0, width, height);
  let current: Raster = { width, height, data: Float32Array.from(image.data, (v) => v / 255) };
  for (const fx of enabled) {
    if (styleEffects.has(fx.type)) continue;
    const params = resolvedParams(fx);
    if (fx.type === "blur")
      current = await blur(current, Math.max(0, Number(params.radius)) * pixelsPerUnit, work);
    else if (fx.type === "sharpen") current = await sharpen(current, Number(params.amount), work);
    else if (fx.type === "pixelate")
      current = pixelate(current, Math.max(1, Number(params.scale) * pixelsPerUnit), signal);
    else {
      const effect = compileEffect(
        fx,
        fx.type === "lut" && Number(params.intensity) !== 0
          ? await lut?.(String(params.path ?? ""))
          : undefined,
      );
      for (let y = 0; y < height; y++) {
        if (y % 256 === 0) {
          signal?.throwIfAborted();
          if (y) await new Promise((resolve) => setTimeout(resolve, 0));
        }
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4;
          if (!current.data[i + 3]) continue;
          const rgb: RGB = [current.data[i]!, current.data[i + 1]!, current.data[i + 2]!];
          const out = effect(rgb, (x + 0.5) / width, (y + 0.5) / height);
          for (let c = 0; c < 3; c++) current.data[i + c] = out[c]!;
        }
      }
    }
  }
  for (let i = 0; i < image.data.length; i++) image.data[i] = current.data[i]! * 255;
  signal?.throwIfAborted();
  ctx.putImageData(image, 0, 0);
  return canvas;
}
