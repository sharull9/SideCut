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
import {
  animationState,
  currentWord,
  resolveText,
  textContent,
  wordRange,
} from "@sidecut/core/text";
import { drawText, ensureFont } from "./text";
import { cardOf } from "@sidecut/core/section-cards";
import { cutoutOf } from "@sidecut/core/cutout";
import { drawSectionCard, ensureCardFonts } from "./section-card";

// Text draws at the clip's own scale so a big title stays sharp; animation scales from there.
async function textLayer(layer: PictureLayer, width: number, height: number) {
  const content = textContent(layer.clip);
  if (!content) return null;
  const text = resolveText(content),
    style = text.style;
  const state = animationState(layer.clipTime, layer.clip.duration.seconds, text);
  const transform = object(layer.clip.video?.transform),
    position = object(transform.position);
  const staticScale = typeof transform.scale === "number" ? transform.scale : 1;
  const renderScale = Math.min(Math.max(1, staticScale), 4),
    px = pixelScale(width, height) * renderScale;
  let visible: number | null = null;
  if (state.visibleFraction < 1) {
    const characters = [...text.text];
    visible = characters
      .slice(0, Math.round(characters.length * state.visibleFraction))
      .join("").length;
  }
  await ensureFont(style.font, style.weight, text.text);
  const highlight = currentWord(text, layer.clipTime);
  const canvas = drawText({
    text: text.text,
    font: style.font,
    size: style.size * px,
    weight: style.weight,
    color: style.color,
    strokeColor: style.strokeColor,
    strokeWidth: style.strokeWidth * px,
    backgroundColor: style.backgroundColor,
    alignment: style.alignment,
    shadow: style.shadow,
    lineSpacing: style.lineSpacing,
    maxWidth: (width * 0.9 * renderScale) / Math.max(staticScale, 0.01),
    highlight: highlight == null ? null : wordRange(text, highlight),
    highlightColor: text.highlightColor,
    visibleLength: visible,
    firstLineScale: text.firstLineScale,
    firstLineColor: text.firstLineColor,
  });
  if (!canvas || state.opacity <= 0) return null;
  // Preset placement applies when the clip has no picture properties of its own.
  // Keyframe resolution turns a missing `video` into {}, so empty counts as none.
  const own = Object.values(layer.clip.video ?? {}).some((v) => v != null);
  const place = !own && text.position ? text.position : null;
  const scale = (staticScale * state.scale) / renderScale;
  const x = place?.x ?? (typeof position.x === "number" ? position.x : 0.5),
    y = place?.y ?? (typeof position.y === "number" ? position.y : 0.5);
  return {
    canvas,
    opacity: state.opacity,
    geometry: {
      x: x * width,
      y: (y + state.offsetY) * height,
      width: canvas.width * Math.abs(scale),
      height: canvas.height * Math.abs(scale),
      radians:
        ((typeof transform.rotation === "number" ? transform.rotation : 0) * Math.PI) / 180 +
        (scale < 0 ? Math.PI : 0),
    },
  };
}
const object = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

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
  const text = await textLayer(layer, width, height);
  // Graphics draw at the output size and are placed like any picture fitted to the canvas.
  const card = cardOf(layer.clip);
  if (card) await ensureCardFonts();
  const graphic = card
    ? drawSectionCard(card, width, height, layer.clipTime, layer.clip.duration.seconds)
    : null;
  if (card && !graphic) return null;
  const mediaReader = layer.mediaID ? await reader(layer.mediaID) : null;
  const frame = mediaReader ? await mediaReader.frame(layer.sourceTime) : null;
  signal?.throwIfAborted();
  if (!frame && !layer.color && !text && !graphic) return null;
  const media = project.media.find((m) => m.id === layer.mediaID);
  const effects = [
    ...((media?.look ?? []) as readonly ClipEffect[]),
    ...effectsOf(layer.clip, "video"),
  ];
  const sw = text?.canvas.width ?? frame?.width ?? width,
    sh = text?.canvas.height ?? frame?.height ?? height;
  const opacity =
    Math.max(0, Math.min(1, Number(layer.clip.video?.opacity ?? 1))) * (text?.opacity ?? 1);
  const geometry = text?.geometry ?? layerGeometry(layer.clip, width, height, sw, sh);
  if (geometry.width < 1e-4 || geometry.height < 1e-4) return null;
  let source: CanvasImageSource | null = text?.canvas ?? graphic ?? frame?.canvas ?? null;
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
        sw,
        sh,
        effects,
        lut,
        signal,
        pixelScale(width, height) / (geometry.width / sw),
      );
  }
  const cutout = cutoutOf(layer.clip);
  if (cutout?.enabled && source) {
    if (!mediaReader) throw new Error("Cutout requires an image or video source.");
    source = await mediaReader.cutout(source, sw, sh, layer.sourceTime, cutout);
  }
  const style = layerStyles(effectsOf(layer.clip, "video"), width, height);
  if (source && (style.radius > 0 || style.border > 0 || style.shadow.opacity > 0)) {
    const crop = sourceCrop(layer.clip, sw, sh);
    if (crop.width <= 0 || crop.height <= 0) return null;
    await paintStyledLayer(ctx, source, sw, sh, crop, geometry, style, opacity, signal);
    return frame?.timestamp ?? null;
  }
  ctx.save();
  try {
    ctx.globalAlpha = opacity;
    ctx.translate(geometry.x, geometry.y);
    ctx.rotate(geometry.radians);
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
