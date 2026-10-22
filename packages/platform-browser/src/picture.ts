import type { Project } from "@sidecut/contracts/project";
import { framePlan, layerGeometry, sourceCrop } from "@sidecut/core/render-plan";
import type { ClipEffect } from "@sidecut/contracts/project";
import type { CubeLUT } from "@sidecut/core/cube-lut";
import { effectsOf } from "@sidecut/core/effect-editing";
import { processPicture } from "./color-processing";
import type { LocalMediaReader } from "./preview";

export async function paintPicture(
  ctx: CanvasRenderingContext2D,
  project: Project,
  time: number,
  reader: (mediaID: string) => Promise<LocalMediaReader>,
  signal?: AbortSignal,
  lut?: (path: string) => Promise<CubeLUT>,
): Promise<number | null> {
  const { width, height } = ctx.canvas;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = "black";
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
  let timestamp: number | null = null;
  for (const layer of framePlan(project, time).layers) {
    signal?.throwIfAborted();
    const frame = layer.mediaID
      ? await (await reader(layer.mediaID)).frame(layer.sourceTime)
      : null;
    signal?.throwIfAborted();
    if (!frame && !layer.color) continue;
    const media = project.media.find((m) => m.id === layer.mediaID);
    const effects = [
      ...((media?.look ?? []) as readonly ClipEffect[]),
      ...effectsOf(layer.clip, "video"),
    ];
    let source: CanvasImageSource | null = frame?.canvas ?? null;
    if (effects.some((fx) => fx.enabled !== false)) {
      if (!source && layer.color) {
        const solid = document.createElement("canvas");
        solid.width = width;
        solid.height = height;
        const fill = solid.getContext("2d");
        if (!fill) throw new Error("Canvas color processing is unavailable.");
        const [r, g, b, a] = layer.color;
        fill.fillStyle = `rgba(${r * 255},${g * 255},${b * 255},${a})`;
        fill.fillRect(0, 0, width, height);
        source = solid;
      }
      if (source)
        source = await processPicture(
          source,
          frame?.width ?? width,
          frame?.height ?? height,
          effects,
          lut,
          signal,
        );
    }
    const geometry = layerGeometry(
      layer.clip,
      width,
      height,
      frame?.width ?? width,
      frame?.height ?? height,
    );
    ctx.save();
    try {
      ctx.globalAlpha = Math.max(0, Math.min(1, Number(layer.clip.video?.opacity ?? 1)));
      ctx.translate(geometry.x, geometry.y);
      ctx.rotate(geometry.radians);
      const sw = frame?.width ?? width,
        sh = frame?.height ?? height;
      const crop = sourceCrop(layer.clip, sw, sh);
      if (crop.width <= 0 || crop.height <= 0) continue;
      const x = -geometry.width / 2 + (crop.x / sw) * geometry.width;
      const y = -geometry.height / 2 + (crop.y / sh) * geometry.height;
      const w = (crop.width / sw) * geometry.width,
        h = (crop.height / sh) * geometry.height;
      if (source) {
        ctx.drawImage(source, crop.x, crop.y, crop.width, crop.height, x, y, w, h);
        timestamp = frame?.timestamp ?? null;
      } else if (layer.color) {
        const [r, g, b, a] = layer.color;
        ctx.fillStyle = `rgba(${r * 255},${g * 255},${b * 255},${a})`;
        ctx.fillRect(x, y, w, h);
      }
    } finally {
      ctx.restore();
    }
  }
  return timestamp;
}
