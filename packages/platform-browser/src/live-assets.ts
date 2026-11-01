import type { LiveAssets } from "@sidecut/core/live-assets";

/** Procedural SideCut assets, evaluated from frame time without timers or external media. */
export function paintLiveBackground(
  ctx: CanvasRenderingContext2D,
  assets: LiveAssets,
  time: number,
  reducedMotion = false,
) {
  const { width: w, height: h } = ctx.canvas;
  const t = assets.motion && !reducedMotion ? time * assets.speed : 0;
  ctx.save();
  try {
    ctx.fillStyle = assets.color;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = assets.accent;
    ctx.strokeStyle = assets.accent;
    ctx.globalAlpha = 0.3;
    ctx.lineWidth = Math.max(1, h / 360);
    const stroke = (draw: () => void) => {
      ctx.beginPath();
      draw();
      ctx.stroke();
    };
    switch (assets.background) {
      case "solid":
        break;
      case "waves":
        for (let row = 0; row < 8; row++)
          stroke(() => {
            for (let x = 0; x <= w; x += w / 80) {
              const y =
                (h * (row + 0.5)) / 8 + (Math.sin((x / w) * Math.PI * 4 + t + row) * h) / 30;
              if (x === 0) ctx.moveTo(x, y);
              else ctx.lineTo(x, y);
            }
          });
        break;
      case "grid":
        for (let i = -1; i <= 20; i++) {
          const x = ((i + (t % 1)) * w) / 20;
          stroke(() => {
            ctx.moveTo(x, 0);
            ctx.lineTo(x, h);
          });
          const y = ((i + (t % 1)) * h) / 20;
          stroke(() => {
            ctx.moveTo(0, y);
            ctx.lineTo(w, y);
          });
        }
        break;
      case "orbits":
        for (let i = 0; i < 8; i++) {
          ctx.beginPath();
          ctx.arc(
            w / 2 + Math.cos(t * 0.3 + i) * w * 0.3,
            h / 2 + Math.sin(t * 0.3 + i) * h * 0.3,
            h * (0.02 + i * 0.006),
            0,
            Math.PI * 2,
          );
          ctx.fill();
        }
        break;
      case "rings":
        for (let i = 0; i < 10; i++)
          stroke(() =>
            ctx.arc(w / 2, h / 2, ((i + (t % 1) + 0.1) * Math.max(w, h)) / 12, 0, Math.PI * 2),
          );
        break;
      case "particles":
        for (let i = 0; i < 48; i++) {
          ctx.beginPath();
          ctx.arc(
            ((i * 0.61803398875 + t * 0.01) % 1) * w,
            ((i * 0.41421356237 + t * 0.02) % 1) * h,
            h * (0.003 + (i % 3) * 0.002),
            0,
            Math.PI * 2,
          );
          ctx.fill();
        }
        break;
      case "rays":
        ctx.translate(w / 2, h / 2);
        ctx.rotate(t * 0.04);
        for (let i = 0; i < 16; i++) {
          ctx.rotate(Math.PI / 8);
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(w, 0);
          ctx.lineTo(w, h / 10);
          ctx.closePath();
          ctx.fill();
        }
        break;
      case "stripes":
        ctx.translate(w / 2, h / 2);
        ctx.rotate(-Math.PI / 6);
        for (let i = -30; i < 30; i++)
          ctx.fillRect(((i + (t % 1)) * w) / 15, -w - h, w / 30, (w + h) * 2);
        break;
      case "checker":
        for (let x = -1; x < 17; x++)
          for (let y = -1; y < 11; y++)
            if ((x + y) % 2 === 0)
              ctx.fillRect(((x + (t % 1)) * w) / 16, (y * h) / 10, w / 16, h / 10);
        break;
      case "aurora":
        for (let i = 0; i < 5; i++) {
          const x = (0.5 + Math.sin(t * 0.2 + i) * 0.4) * w;
          const gradient = ctx.createRadialGradient(x, (h * i) / 5, 0, x, (h * i) / 5, h * 0.8);
          gradient.addColorStop(0, assets.accent);
          gradient.addColorStop(1, `${assets.accent}00`);
          ctx.fillStyle = gradient;
          ctx.fillRect(0, 0, w, h);
        }
        break;
      case "mesh":
        for (let y = 0; y < 12; y++)
          for (let x = 0; x < 16; x++)
            stroke(() => {
              const px = ((x + Math.sin(t * 0.3 + y) * 0.25) * w) / 15;
              const py = ((y + Math.cos(t * 0.3 + x) * 0.25) * h) / 11;
              ctx.moveTo(px, py);
              ctx.lineTo(px + w / 15, py + (Math.sin(t + x + y) * h) / 40);
              ctx.lineTo(px + w / 30, py + h / 11);
              ctx.closePath();
            });
        break;
      default: {
        const unreachable: never = assets.background;
        throw new Error(`Unknown live background ${unreachable}`);
      }
    }
  } finally {
    ctx.restore();
  }
}

/** Array order is back to front, matching the editor's layer ordering. */
export function paintLiveOverlays(
  ctx: CanvasRenderingContext2D,
  assets: LiveAssets,
  time: number,
  reducedMotion = false,
) {
  const { width: w, height: h } = ctx.canvas;
  for (const item of assets.overlays) {
    if (!item.enabled || time < item.start || time >= item.start + item.duration) continue;
    const local = time - item.start;
    const animate = assets.motion && !reducedMotion;
    const entrance =
      animate && item.motion === "slide" ? 1 - (1 - Math.min(1, local / 0.25)) ** 3 : 1;
    const pulse = animate && item.motion === "pulse" ? 0.9 + Math.sin(local * Math.PI) * 0.1 : 1;
    const x = item.kind === "takeover" ? 0 : item.x * w;
    const y = (item.kind === "takeover" ? 0 : item.y * h) + (1 - entrance) * h * 0.05;
    const width = item.kind === "takeover" ? w : item.width * w;
    const height = item.kind === "takeover" ? h : item.height * h;
    ctx.save();
    try {
      ctx.globalAlpha = item.opacity * pulse * entrance;
      ctx.fillStyle = item.color;
      if (item.kind === "highlight") {
        ctx.strokeStyle = item.color;
        ctx.lineWidth = Math.max(2, h / 180);
        ctx.strokeRect(
          x + ctx.lineWidth / 2,
          y + ctx.lineWidth / 2,
          width - ctx.lineWidth,
          height - ctx.lineWidth,
        );
      } else ctx.fillRect(x, y, width, height);
      ctx.beginPath();
      ctx.rect(x, y, width, height);
      ctx.clip();
      ctx.fillStyle = item.textColor;
      ctx.font = `600 ${Math.max(10, Math.min(height * 0.4, h / 18))}px sans-serif`;
      ctx.textBaseline = "middle";
      ctx.textAlign = "center";
      if (item.text)
        ctx.fillText(item.text, x + width / 2, y + height / 2, Math.max(1, width - h / 30));
    } finally {
      ctx.restore();
    }
  }
}
