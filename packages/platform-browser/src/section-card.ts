// Drawing ported from TandemRender/SectionCardRenderer.swift and CardFonts.swift with Canvas 2D.
// Notice: tests/fixtures/tandem/TANDEM-LICENSE. Typefaces: Anton, Instrument Sans and
// JetBrains Mono (SIL OFL 1.1) from Fontsource, as the reference bundles them.
import {
  CardMotion,
  MOTION,
  cardProgress,
  kickerLine,
  type Band,
  type CardProps,
  type RGBA,
} from "@sidecut/core/section-cards";
import anton from "@fontsource/anton/files/anton-latin-400-normal.woff2?url";
import instrumentSans from "@fontsource-variable/instrument-sans/files/instrument-sans-latin-wght-normal.woff2?url";
import jetbrainsMono from "@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2?url";

const LATIN =
  "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD";
const FACES = [
  { family: "SideCut Card Anton", url: anton, weight: "400" },
  { family: "SideCut Card Sans", url: instrumentSans, weight: "400 700" },
  { family: "SideCut Card Mono", url: jetbrainsMono, weight: "100 800" },
];
let loaded: Promise<void> | null = null;
/** Loads the card typefaces once; a failed load falls back to system faces as the reference does. */
export function ensureCardFonts(): Promise<void> {
  if (typeof document === "undefined") return Promise.resolve();
  loaded ??= Promise.all(
    FACES.map(async (face) => {
      const font = new FontFace(face.family, `url(${face.url})`, {
        weight: face.weight,
        unicodeRange: LATIN,
      });
      document.fonts.add(await font.load());
    }),
  ).then(
    () => {
      layers.clear();
    },
    () => undefined,
  );
  return loaded;
}
const font = {
  title: (size: number) => `400 ${size}px "SideCut Card Anton", Impact, "Arial Narrow", sans-serif`,
  sans: (size: number, weight: number) =>
    `${weight} ${size}px "SideCut Card Sans", system-ui, sans-serif`,
  mono: (size: number, weight: number) =>
    `${weight} ${size}px "SideCut Card Mono", ui-monospace, Consolas, monospace`,
};
const css = (c: RGBA) =>
  `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${c.a})`;
const KICKER = "rgb(217,220,225)",
  COUNT = "rgb(207,211,217)",
  UNLIT = "rgba(255,255,255,0.28)";

interface Text {
  text: string;
  font: string;
  spacing: number;
  color: string;
  x: number;
  baseline: number;
  width: number;
}
interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
  color: string;
}
interface Row {
  height: number;
  marginTop: number;
  boxes: Box[];
  texts: Text[];
  cursor?: { x: number; y: number; width: number; height: number };
}

/** Where the card's words, chip and progress row go, from the top left (the mockup's CSS). */
export function cardLayout(props: CardProps, w: number, h: number, ctx: CanvasRenderingContext2D) {
  const u = w / 100;
  const measure = (text: string, f: string, spacing: number) => {
    ctx.font = f;
    ctx.letterSpacing = `${spacing}px`;
    const m = ctx.measureText(text);
    return { width: m.width, ascent: m.fontBoundingBoxAscent, descent: m.fontBoundingBoxDescent };
  };
  // A CSS line box: the font's ascent and descent centred in the line height.
  const baseline = (top: number, lineHeight: number, f: string) => {
    const m = measure("", f, 0);
    return top + (lineHeight - (m.ascent + m.descent)) / 2 + m.ascent;
  };
  const wrap = (text: string, f: string, spacing: number, maxWidth: number, balanced: boolean) =>
    text.split("\n").flatMap((paragraph) => {
      const words = paragraph.trim().split(/\s+/).filter(Boolean);
      if (!words.length) return [];
      const lines = (width: number) => {
        const result: string[] = [];
        let line = "";
        for (const word of words) {
          const next = line ? `${line} ${word}` : word;
          if (line && measure(next, f, spacing).width > width) {
            result.push(line);
            line = word;
          } else line = next;
        }
        if (line) result.push(line);
        return result;
      };
      const greedy = lines(maxWidth);
      if (!balanced || greedy.length <= 1) return greedy;
      let low = maxWidth / (greedy.length + 1),
        high = maxWidth,
        best = greedy;
      for (let i = 0; i < 24; i++) {
        const middle = (low + high) / 2,
          attempt = lines(middle);
        if (attempt.length <= greedy.length) {
          best = attempt;
          high = middle;
        } else low = middle;
      }
      return best;
    });
  const accent = css(props.colors.accent);
  const rows: Row[] = [];

  const number = props.number.trim();
  const kicker = kickerLine(props)?.toUpperCase() ?? null;
  if (number || kicker) {
    const row: Row = { height: 0, marginTop: 0, boxes: [], texts: [] };
    const items: { width: number; height: number; place: (left: number, top: number) => void }[] =
      [];
    if (number) {
      const size = 1.6 * u,
        f = font.mono(size, 700),
        spacing = 0.08 * size;
      const width = measure(number, f, spacing).width;
      const chip = { width: width + 2 * u, height: size + 1.1 * u };
      items.push({
        ...chip,
        place: (left, top) => {
          row.boxes.push({ x: left, y: top, ...chip, radius: 0.5 * u, color: accent });
          row.texts.push({
            text: number,
            font: f,
            spacing,
            color: css(props.colors.background),
            x: left + u,
            baseline: baseline(top + 0.55 * u, size, f),
            width,
          });
        },
      });
    }
    if (kicker) {
      const size = 1.45 * u,
        f = font.sans(size, 600),
        spacing = 0.2 * size;
      const width = measure(kicker, f, spacing).width;
      items.push({
        width,
        height: size,
        place: (left, top) =>
          row.texts.push({
            text: kicker,
            font: f,
            spacing,
            color: KICKER,
            x: left,
            baseline: baseline(top, size, f),
            width,
          }),
      });
    }
    const gap = 1.4 * u;
    const rowWidth = items.reduce((s, i) => s + i.width, 0) + gap * Math.max(0, items.length - 1);
    row.height = Math.max(...items.map((i) => i.height));
    let x = (w - rowWidth) / 2;
    for (const item of items) {
      item.place(x, (row.height - item.height) / 2);
      x += item.width + gap;
    }
    rows.push(row);
  }

  const title = props.title.trim().toUpperCase();
  if (title) {
    const size = 9.4 * u,
      f = font.title(size),
      lineHeight = 0.95 * size,
      spacing = 0.01 * size;
    const row: Row = { height: 0, marginTop: 0, boxes: [], texts: [] };
    for (const text of wrap(title, f, spacing, 84 * u, true)) {
      const width = measure(text, f, spacing).width;
      row.texts.push({
        text,
        font: f,
        spacing,
        color: "#ffffff",
        x: (w - width) / 2,
        baseline: baseline(row.height, lineHeight, f),
        width,
      });
      row.height += lineHeight;
    }
    // The cursor hangs after the last line, which stays centred, so words don't shift as it blinks.
    const last = row.texts.at(-1);
    if (props.cursor && last) {
      ctx.font = f;
      ctx.letterSpacing = "0px";
      const capHeight = ctx.measureText("H").actualBoundingBoxAscent;
      row.cursor = {
        x: last.x + last.width + 0.07 * size,
        y: last.baseline - capHeight,
        width: 0.1 * size,
        height: capHeight,
      };
    }
    rows.push(row);
  }

  const subtitle = props.subtitle.trim().toUpperCase();
  if (subtitle) {
    const size = 1.7 * u,
      f = font.sans(size, 600),
      spacing = 0.34 * size;
    const row: Row = { height: 0, marginTop: 0, boxes: [], texts: [] };
    for (const text of wrap(subtitle, f, spacing, 84 * u, false)) {
      const width = measure(text, f, spacing).width;
      // The same space on the left as the letter-spacing after the last letter, so it's centred.
      row.texts.push({
        text,
        font: f,
        spacing,
        color: accent,
        x: (w - (spacing + width)) / 2 + spacing,
        baseline: baseline(row.height, size, f),
        width,
      });
      row.height += size;
    }
    rows.push(row);
  }

  const progress = cardProgress(props);
  if (progress) {
    const barHeight = 0.35 * u,
      gap = 0.6 * u;
    let bars: { width: number; color: string }[];
    let count: { text: string; font: string; width: number; size: number } | null = null;
    if (progress.kind === "bars")
      bars = Array.from({ length: progress.count }, (_, i) => ({
        width: 5 * u,
        color: i + 1 <= progress.lit ? accent : UNLIT,
      }));
    else {
      bars = [
        { width: (progress.index / progress.total) * 30 * u, color: accent },
        { width: ((progress.total - progress.index) / progress.total) * 30 * u, color: UNLIT },
      ];
      const size = 1.5 * u,
        f = font.mono(size, 500),
        text = `${progress.index} / ${progress.total}`;
      count = { text, font: f, width: measure(text, f, 0).width, size };
    }
    const row: Row = {
      height: Math.max(barHeight, count?.size ?? 0),
      marginTop: 0.6 * u,
      boxes: [],
      texts: [],
    };
    const items = bars.length + (count ? 1 : 0);
    const rowWidth =
      bars.reduce((s, b) => s + b.width, 0) + (count?.width ?? 0) + gap * Math.max(0, items - 1);
    let x = (w - rowWidth) / 2;
    for (const bar of bars) {
      row.boxes.push({
        x,
        y: (row.height - barHeight) / 2,
        width: bar.width,
        height: barHeight,
        radius: Math.min(u, barHeight / 2),
        color: bar.color,
      });
      x += bar.width + gap;
    }
    if (count)
      row.texts.push({
        text: count.text,
        font: count.font,
        spacing: 0,
        color: COUNT,
        x,
        baseline: baseline((row.height - count.size) / 2, count.size, count.font),
        width: count.width,
      });
    rows.push(row);
  }

  // The rows, 1.6cqw apart, as a block in the middle of the frame.
  const rowGap = 1.6 * u;
  const total = rows.reduce((s, r, i) => s + r.height + r.marginTop + (i > 0 ? rowGap : 0), 0);
  let top = (h - total) / 2;
  const boxes: Box[] = [],
    texts: Text[] = [];
  let cursor: Row["cursor"] | null = null;
  rows.forEach((row, i) => {
    if (i > 0) top += rowGap;
    top += row.marginTop;
    boxes.push(...row.boxes.map((b) => ({ ...b, y: b.y + top })));
    texts.push(...row.texts.map((t) => ({ ...t, baseline: t.baseline + top })));
    if (row.cursor) cursor = { ...row.cursor, y: row.cursor.y + top };
    top += row.height;
  });
  return { boxes, texts, cursor: cursor as Row["cursor"] | null };
}

const layers = new Map<string, { image: HTMLCanvasElement; cursor: Row["cursor"] | null }>();
function contentLayer(props: CardProps, w: number, h: number) {
  const key = `${w}x${h}:${JSON.stringify(props)}`;
  const hit = layers.get(key);
  if (hit) return hit;
  const image = document.createElement("canvas");
  image.width = w;
  image.height = h;
  const ctx = image.getContext("2d")!;
  const layout = cardLayout(props, w, h, ctx);
  for (const box of layout.boxes) {
    ctx.fillStyle = box.color;
    ctx.beginPath();
    ctx.roundRect(
      box.x,
      box.y,
      box.width,
      box.height,
      Math.min(box.radius, box.width / 2, box.height / 2),
    );
    ctx.fill();
  }
  ctx.textBaseline = "alphabetic";
  for (const text of layout.texts) {
    ctx.font = text.font;
    ctx.letterSpacing = `${text.spacing}px`;
    ctx.fillStyle = text.color;
    ctx.fillText(text.text, text.x, text.baseline);
  }
  if (layers.size >= 16) layers.delete(layers.keys().next().value!);
  const layer = { image, cursor: layout.cursor };
  layers.set(key, layer);
  return layer;
}

const MARGIN = 4;
// A band's left edge x at screen y (down from the top): the top leans right.
const edge = (band: Band, w: number, h: number, y: number) =>
  w * (band.left + band.lean * (0.5 - y / h));

/** The card `t` seconds into a clip `duration` long, the size of the frame, or null when hidden. */
export function drawSectionCard(
  props: CardProps,
  w: number,
  h: number,
  t: number,
  duration: number,
): HTMLCanvasElement | null {
  if (w < 2 || h < 2) return null;
  const motion = CardMotion.of(duration, w, h);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  const reveal = motion.reveal(t);
  if (!reveal.hidden) {
    ctx.save();
    const clip = (band: Band, far: number) => {
      ctx.beginPath();
      ctx.moveTo(far, -MARGIN);
      ctx.lineTo(edge(band, w, h, -MARGIN), -MARGIN);
      ctx.lineTo(edge(band, w, h, h + MARGIN), h + MARGIN);
      ctx.lineTo(far, h + MARGIN);
      ctx.closePath();
      ctx.clip();
    };
    if (reveal.before) clip(reveal.before, -w - MARGIN);
    if (reveal.after) clip(reveal.after, 2 * w + MARGIN);
    ctx.fillStyle = css(props.colors.background);
    ctx.fillRect(0, 0, w, h);
    const progress = motion.contentProgress(t);
    if (progress > 0) {
      const layer = contentLayer(props, w, h);
      const scale = MOTION.contentScale + (1 - MOTION.contentScale) * progress;
      const drop = MOTION.contentRise * w * (1 - progress);
      ctx.globalAlpha = Math.min(Math.max(progress, 0), 1);
      ctx.translate(w / 2, h / 2 + drop);
      ctx.scale(scale, scale);
      ctx.translate(-w / 2, -h / 2);
      ctx.drawImage(layer.image, 0, 0);
      if (props.cursor && layer.cursor && motion.cursorLit(t)) {
        ctx.fillStyle = css(props.colors.accent);
        ctx.fillRect(layer.cursor.x, layer.cursor.y, layer.cursor.width, layer.cursor.height);
      }
    }
    ctx.restore();
  }
  const colors = [props.colors.accent, props.colors.band2, props.colors.band3];
  const bandWidth = w * MOTION.bandWidth;
  for (const { index, band } of motion.bands(t)) {
    const top = edge(band, w, h, -MARGIN),
      bottom = edge(band, w, h, h + MARGIN);
    ctx.beginPath();
    ctx.moveTo(top, -MARGIN);
    ctx.lineTo(top + bandWidth, -MARGIN);
    ctx.lineTo(bottom + bandWidth, h + MARGIN);
    ctx.lineTo(bottom, h + MARGIN);
    ctx.closePath();
    ctx.fillStyle = css(colors[index]!);
    ctx.fill();
  }
  return canvas;
}
