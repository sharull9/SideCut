import type { LayerStyles } from "@sidecut/core/layer-styles";
import type { LayerGeometry } from "@sidecut/core/render-plan";
import { gaussian, raster } from "@sidecut/core/spatial-processing";
const canvas = (width: number, height: number) => {
  const value = document.createElement("canvas");
  value.width = width;
  value.height = height;
  const context = value.getContext("2d");
  if (!context) throw new Error("Canvas layer styling is unavailable.");
  return { value, context };
};
const rgba = (c: readonly number[]) => `rgba(${c[0]! * 255},${c[1]! * 255},${c[2]! * 255},${c[3]})`;
export async function paintStyledLayer(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  crop: { x: number; y: number; width: number; height: number },
  geometry: LayerGeometry,
  style: LayerStyles,
  opacity: number,
  signal?: AbortSignal,
) {
  const work = {
    throwIfAborted: () => signal?.throwIfAborted(),
    yield: () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
  };
  const shadow = style.shadow;
  // Retain off-canvas pixels that can cast a visible shadow before the final canvas crop.
  const padding = Math.ceil(
    Math.max(Math.abs(shadow.dx), Math.abs(shadow.dy)) + 4 * shadow.blur + style.border + 2,
  );
  const width = ctx.canvas.width + padding * 2,
    height = ctx.canvas.height + padding * 2;
  const layer = canvas(width, height),
    lc = layer.context;
  const x = -geometry.width / 2 + (crop.x / sourceWidth) * geometry.width,
    y = -geometry.height / 2 + (crop.y / sourceHeight) * geometry.height;
  const w = (crop.width / sourceWidth) * geometry.width,
    h = (crop.height / sourceHeight) * geometry.height;
  const r = Math.min(style.radius, w / 2, h / 2),
    b = style.border;
  lc.save();
  lc.translate(geometry.x + padding, geometry.y + padding);
  lc.rotate(geometry.radians);
  if (b > 0) {
    lc.fillStyle = rgba(style.borderColor);
    lc.beginPath();
    lc.roundRect(x - b, y - b, w + 2 * b, h + 2 * b, r > 0 ? r + b : 0);
    lc.fill();
  }
  lc.save();
  if (r > 0) {
    lc.beginPath();
    lc.roundRect(x, y, w, h, r);
    lc.clip();
  }
  lc.drawImage(source, crop.x, crop.y, crop.width, crop.height, x, y, w, h);
  lc.restore();
  lc.restore();
  signal?.throwIfAborted();
  let output = layer.value;
  if (shadow.opacity > 0 && shadow.color[3] > 0) {
    const pixels = lc.getImageData(0, 0, width, height),
      mask = raster(width, height);
    for (let i = 3; i < pixels.data.length; i += 4) mask.data[i] = pixels.data[i]! / 255;
    const soft = await gaussian(mask, shadow.blur, false, work),
      tint = canvas(width, height),
      image = tint.context.createImageData(width, height);
    for (let i = 0; i < image.data.length; i += 4) {
      for (let c = 0; c < 3; c++) image.data[i + c] = shadow.color[c]! * 255;
      image.data[i + 3] = soft.data[i + 3]! * shadow.opacity * shadow.color[3] * 255;
    }
    tint.context.putImageData(image, 0, 0);
    const combined = canvas(width, height);
    combined.context.drawImage(tint.value, shadow.dx, shadow.dy);
    combined.context.drawImage(layer.value, 0, 0);
    output = combined.value;
  }
  signal?.throwIfAborted();
  ctx.save();
  try {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = opacity;
    ctx.drawImage(output, -padding, -padding);
  } finally {
    ctx.restore();
  }
}
