import type { Project } from "@sidecut/contracts/project";
import { framePlan, layerGeometry } from "@sidecut/core/render-plan";
import type { LocalMediaReader } from "./preview";

export async function paintPicture(
  ctx: CanvasRenderingContext2D,
  project: Project,
  time: number,
  reader: (mediaID: string) => Promise<LocalMediaReader>,
  signal?: AbortSignal,
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
    const geometry = layerGeometry(
      layer.clip,
      width,
      height,
      frame?.width ?? width,
      frame?.height ?? height,
    );
    ctx.save();
    try {
      ctx.translate(geometry.x, geometry.y);
      ctx.rotate(geometry.radians);
      if (frame) {
        ctx.drawImage(
          frame.canvas,
          -geometry.width / 2,
          -geometry.height / 2,
          geometry.width,
          geometry.height,
        );
        timestamp = frame.timestamp;
      } else if (layer.color) {
        const [r, g, b, a] = layer.color;
        ctx.fillStyle = `rgba(${r * 255},${g * 255},${b * 255},${a})`;
        ctx.fillRect(-geometry.width / 2, -geometry.height / 2, geometry.width, geometry.height);
      }
    } finally {
      ctx.restore();
    }
  }
  return timestamp;
}
