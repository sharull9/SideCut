import type { ClipEffect } from "@sidecut/contracts/project";
import type { CubeLUT } from "@sidecut/core/cube-lut";
import { compileEffect } from "@sidecut/core/color-processing";
import type { RGB } from "@sidecut/core/color-processing";
import { resolvedParams } from "@sidecut/core/effects";
export async function processPicture(
  source: CanvasImageSource,
  width: number,
  height: number,
  effects: readonly ClipEffect[],
  lut: ((path: string) => Promise<CubeLUT>) | undefined,
  signal?: AbortSignal,
): Promise<CanvasImageSource> {
  const enabled = effects.filter((fx) => fx.enabled !== false);
  if (!enabled.length) return source;
  const pipeline = await Promise.all(
    enabled.map(async (fx) => {
      const params = resolvedParams(fx);
      return compileEffect(
        fx,
        fx.type === "lut" && Number(params.intensity) !== 0
          ? await lut?.(String(params.path ?? ""))
          : undefined,
      );
    }),
  );
  signal?.throwIfAborted();
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas color processing is unavailable.");
  ctx.drawImage(source, 0, 0);
  const image = ctx.getImageData(0, 0, width, height),
    data = image.data;
  for (let y = 0; y < height; y++) {
    if (y % 256 === 0) {
      signal?.throwIfAborted();
      if (y) await new Promise((resolve) => setTimeout(resolve, 0));
    }
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (!data[i + 3]) continue;
      let rgb: RGB = [data[i]! / 255, data[i + 1]! / 255, data[i + 2]! / 255];
      for (const effect of pipeline) rgb = effect(rgb, (x + 0.5) / width, (y + 0.5) / height);
      for (let c = 0; c < 3; c++) data[i + c] = rgb[c]! * 255;
    }
  }
  signal?.throwIfAborted();
  ctx.putImageData(image, 0, 0);
  return canvas;
}
