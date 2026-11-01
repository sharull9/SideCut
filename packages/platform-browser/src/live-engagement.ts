import type { LiveChat } from "@sidecut/core/live-chat";
import type { LiveCaptions, CaptionTarget } from "@sidecut/core/live-captions";
import type { LiveCompanion } from "@sidecut/core/live-companion";
import { DEFAULT_LIVE_ASSETS } from "@sidecut/core/live-assets";
import { paintLiveOverlays } from "./live-assets";

export type LiveEngagement = {
  target: CaptionTarget;
  chat?: LiveChat;
  captions?: LiveCaptions;
  companion?: LiveCompanion;
};

/** Paint onto the staging frame, so preview/recording commit all overlays together. */
export function paintLiveEngagement(
  ctx: CanvasRenderingContext2D,
  engagement: LiveEngagement,
  time: number,
  reducedMotion: boolean,
) {
  const { width: w, height: h } = ctx.canvas;
  const highlight = engagement.chat?.overlay(time);
  if (highlight)
    paintLiveOverlays(ctx, { ...DEFAULT_LIVE_ASSETS, overlays: [highlight] }, time, true);
  const caption = engagement.captions?.text(engagement.target, time);
  if (caption)
    paintLiveOverlays(
      ctx,
      {
        ...DEFAULT_LIVE_ASSETS,
        overlays: [
          {
            id: "live-caption",
            kind: "banner",
            text: caption,
            x: 0.05,
            y: 0.85,
            width: 0.9,
            height: 0.1,
            color: "#111827",
            textColor: "#ffffff",
            enabled: true,
            opacity: 1,
            motion: "none",
            start: time,
            duration: 1,
          },
        ],
      },
      time,
      true,
    );
  const companion = engagement.companion?.frame(time, reducedMotion);
  if (!companion) return;
  const size = Math.min(w, h) * 0.12;
  ctx.save();
  try {
    ctx.translate(w * 0.88, h * 0.56);
    ctx.scale(companion.scale, companion.scale);
    ctx.fillStyle = companion.profile.color;
    ctx.beginPath();
    if (companion.profile.avatar === "robot") ctx.rect(-size, -size, size * 2, size * 2);
    else ctx.arc(0, 0, size, 0, Math.PI * 2);
    ctx.fill();
    if (companion.profile.avatar === "cat") {
      ctx.beginPath();
      ctx.moveTo(-size, -size * 0.3);
      ctx.lineTo(-size, -size * 1.4);
      ctx.lineTo(0, -size * 0.7);
      ctx.moveTo(size, -size * 0.3);
      ctx.lineTo(size, -size * 1.4);
      ctx.lineTo(0, -size * 0.7);
      ctx.fill();
    }
    ctx.fillStyle = "#111827";
    for (const x of [-0.35, 0.35]) {
      ctx.beginPath();
      ctx.arc(size * x, -size * 0.15, size * 0.1, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = "#111827";
    ctx.lineWidth = Math.max(1, size * 0.08);
    ctx.beginPath();
    if (companion.reaction === "surprised") ctx.arc(0, size * 0.4, size * 0.15, 0, Math.PI * 2);
    else ctx.arc(0, size * 0.1, size * 0.45, 0.2, Math.PI - 0.2);
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.font = `600 ${Math.max(10, size * 0.4)}px sans-serif`;
    ctx.fillText(companion.profile.name, 0, size * 1.1, size * 3);
  } finally {
    ctx.restore();
  }
}
