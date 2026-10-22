import type { PictureLayer, PictureNode } from "@sidecut/core/render-plan";
import { surface, renderTransition } from "./transitions";
import type { Project } from "@sidecut/contracts/project";
import { framePlan, layerGeometry, sourceCrop } from "@sidecut/core/render-plan";
import type { ClipEffect } from "@sidecut/contracts/project";
import type { CubeLUT } from "@sidecut/core/cube-lut";
import { effectsOf } from "@sidecut/core/effect-editing";
import { pixelScale, layerStyles } from "@sidecut/core/layer-styles";
import { paintStyledLayer } from "./layer-styles";
import { processPicture } from "./color-processing";
import type { LocalMediaReader } from "./preview";

async function paintLayer(
  ctx: CanvasRenderingContext2D,
  layer: PictureLayer,
  project: Project,
  reader: (mediaID: string) => Promise<LocalMediaReader>,
  signal?: AbortSignal,
  lut?: (path: string) => Promise<CubeLUT>,
): Promise<number | null> {
  const { width, height } = ctx.canvas;
  let timestamp: number | null = null;

  signal?.throwIfAborted();
  const frame = layer.mediaID ? await (await reader(layer.mediaID)).frame(layer.sourceTime) : null;
  signal?.throwIfAborted();
  if (!frame && !layer.color) return null;
  const media = project.media.find((m) => m.id === layer.mediaID);
  const effects = [
    ...((media?.look ?? []) as readonly ClipEffect[]),
    ...effectsOf(layer.clip, "video"),
  ];
  const geometry = layerGeometry(
    layer.clip,
    width,
    height,
    frame?.width ?? width,
    frame?.height ?? height,
  );
  if (geometry.width < 1e-4 || geometry.height < 1e-4) return null;
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
        pixelScale(width, height) / (geometry.width / (frame?.width ?? width)),
      );
  }
  const style = layerStyles(effectsOf(layer.clip, "video"), width, height);
  if (source && (style.radius > 0 || style.border > 0 || style.shadow.opacity > 0)) {
    const sw = frame?.width ?? width,
      sh = frame?.height ?? height,
      crop = sourceCrop(layer.clip, sw, sh);
    if (crop.width <= 0 || crop.height <= 0) return null;
    await paintStyledLayer(
      ctx,
      source,
      sw,
      sh,
      crop,
      geometry,
      style,
      Math.max(0, Math.min(1, Number(layer.clip.video?.opacity ?? 1))),
      signal,
    );
    return frame?.timestamp ?? null;
  }
  ctx.save();
  try {
    ctx.globalAlpha = Math.max(0, Math.min(1, Number(layer.clip.video?.opacity ?? 1)));
    ctx.translate(geometry.x, geometry.y);
    ctx.rotate(geometry.radians);
    const sw = frame?.width ?? width,
      sh = frame?.height ?? height;
    const crop = sourceCrop(layer.clip, sw, sh);
    if (crop.width <= 0 || crop.height <= 0) return null;
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
  return timestamp;
}

export async function paintPicture(
  ctx: CanvasRenderingContext2D,
  project: Project,
  time: number,
  reader: (mediaID: string) => Promise<LocalMediaReader>,
  signal?: AbortSignal,
  lut?: (path: string) => Promise<CubeLUT>,
): Promise<number | null> {
  const { width, height } = ctx.canvas;
  let timestamp: number | null = null;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = "black";
  ctx.fillRect(0, 0, width, height);
  try {
    const render = async (
      node: PictureNode,
      below: HTMLCanvasElement,
    ): Promise<HTMLCanvasElement> => {
      signal?.throwIfAborted();
      if (node.kind === "transition") {
        const from = node.from ? await render(node.from, below) : null,
          to = node.to ? await render(node.to, below) : null;
        return renderTransition(
          from,
          to,
          node.transition,
          (time - node.start) / (node.end - node.start),
          width,
          height,
          node.end - node.start,
          project.settings.frameRate.denominator / project.settings.frameRate.numerator,
        );
      }
      const layer = node.layer,
        out = surface(width, height);
      if (layer.clip.content.adjustment != null) {
        const processed = await processPicture(
          below,
          width,
          height,
          effectsOf(layer.clip, "video"),
          lut,
          signal,
          pixelScale(width, height),
        );
        out.context.globalAlpha = Math.max(0, Math.min(1, Number(layer.clip.video?.opacity ?? 1)));
        out.context.drawImage(processed, 0, 0);
      } else
        timestamp =
          (await paintLayer(out.context, layer, project, reader, signal, lut)) ?? timestamp;
      return out.value;
    };
    for (const node of framePlan(project, time).nodes) {
      const below = surface(width, height);
      below.context.drawImage(ctx.canvas, 0, 0);
      const image = await render(node, below.value);
      signal?.throwIfAborted();
      ctx.drawImage(image, 0, 0);
    }
    return timestamp;
  } finally {
    ctx.restore();
  }
}
