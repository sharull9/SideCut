// Drawing ported from TandemRender/TextRenderer.swift with Canvas 2D in place of Core Text.
// Notice: tests/fixtures/tandem/TANDEM-LICENSE.
import type { RGBA } from "@sidecut/core/text";
import { isSystemFont } from "@sidecut/core/text";
import tiltWarpLatin from "@fontsource/tilt-warp/files/tilt-warp-latin-400-normal.woff2?url";
import tiltWarpLatinExt from "@fontsource/tilt-warp/files/tilt-warp-latin-ext-400-normal.woff2?url";
import { derivedCache } from "./derived-cache";

/** Everything that changes the drawn pixels. Sizes are output pixels. */
export interface TextRequest {
  text: string;
  font: string;
  size: number;
  weight: number;
  color: RGBA;
  strokeColor: RGBA | null;
  strokeWidth: number;
  backgroundColor: RGBA | null;
  alignment: string;
  shadow: boolean;
  lineSpacing: number;
  /** Lines wrap at this width. */
  maxWidth: number;
  /** UTF-16 range drawn in highlightColor (the word being spoken). */
  highlight: [number, number] | null;
  highlightColor: RGBA;
  /** Typewriter: UTF-16 length of the visible prefix, null for all. */
  visibleLength: number | null;
  firstLineScale: number;
  firstLineColor: RGBA | null;
}

const SYSTEM_STACK = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
export function cssFont(family: string, size: number, weight: number) {
  const w = Math.round(Math.min(1000, Math.max(1, weight)));
  const stack = isSystemFont(family)
    ? SYSTEM_STACK
    : `"${family.replace(/["\\]/g, "")}", ${SYSTEM_STACK}`;
  return `${w} ${size}px ${stack}`;
}
const css = (c: RGBA) =>
  `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${c.a})`;

// MARK: Fonts

/** Fonts that ship with SideCut because a built-in preset names them (OFL-1.1, Fontsource). */
const BUNDLED: Record<string, { url: string; unicodeRange?: string }[]> = {
  "tilt warp": [
    {
      url: tiltWarpLatin,
      unicodeRange:
        "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD",
    },
    {
      url: tiltWarpLatinExt,
      unicodeRange:
        "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF",
    },
  ],
};
const BUNDLED_NAMES: Record<string, string> = { "tilt warp": "Tilt Warp" };
const registered = new Map<string, string>();
const loading = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();
export const subscribeFonts = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
function changed() {
  drawings.clear();
  for (const listener of listeners) listener();
}

/** Loads the faces a title needs; resolves when they are drawable or known to be absent. */
export function ensureFont(family: string, weight: number, text = "A"): Promise<void> {
  if (typeof document === "undefined" || isSystemFont(family)) return Promise.resolve();
  const key = family.toLowerCase();
  const bundled = BUNDLED[key];
  if (bundled && !registered.has(key)) {
    let pending = loading.get(key);
    if (!pending) {
      pending = Promise.all(
        bundled.map(async (face) => {
          const font = new FontFace(BUNDLED_NAMES[key]!, `url(${face.url})`, {
            weight: "400",
            ...(face.unicodeRange ? { unicodeRange: face.unicodeRange } : {}),
          });
          document.fonts.add(await font.load());
        }),
      ).then(() => {
        registered.set(key, BUNDLED_NAMES[key]!);
        changed();
      });
      loading.set(key, pending);
    }
    return pending;
  }
  return document.fonts.load(cssFont(family, 24, weight), text).then(() => undefined);
}

let probe: CanvasRenderingContext2D | null = null;
const measured = new Map<string, boolean>();
/** True when titles can draw `name` instead of falling back to the system font. */
export function fontAvailable(name: string): boolean {
  if (isSystemFont(name)) return true;
  const key = name.toLowerCase();
  if (registered.has(key) || BUNDLED[key]) return true;
  if (typeof document === "undefined") return false;
  for (const face of document.fonts)
    if (face.family.replace(/^["']|["']$/g, "").toLowerCase() === key && face.status === "loaded")
      return true;
  const cached = measured.get(key);
  if (cached !== undefined) return cached;
  probe ??= document.createElement("canvas").getContext("2d");
  if (!probe) return false;
  const sample = "mmmmmmmmmmlli10WQ@#",
    safe = name.replace(/["\\]/g, "");
  // A local font changes at least one generic fallback's metrics.
  const found = ["monospace", "serif", "sans-serif"].some((generic) => {
    probe!.font = `72px ${generic}`;
    const base = probe!.measureText(sample).width;
    probe!.font = `72px "${safe}", ${generic}`;
    return probe!.measureText(sample).width !== base;
  });
  measured.set(key, found);
  return found;
}

interface FontNames {
  family: string;
  aliases: string[];
  weight: number;
  italic: boolean;
}
// Reads OpenType `name` (IDs 1, 2, 4, 6, 16) and `OS/2` weight from a TTF/OTF file.
export function fontNames(buffer: ArrayBuffer): FontNames | null {
  const view = new DataView(buffer);
  if (view.byteLength < 12) return null;
  const tag = view.getUint32(0);
  if (tag !== 0x00010000 && tag !== 0x4f54544f && tag !== 0x74727565) return null;
  const tables = new Map<string, { offset: number; length: number }>();
  for (let i = 0; i < view.getUint16(4); i++) {
    const at = 12 + i * 16;
    if (at + 16 > view.byteLength) return null;
    const name = String.fromCharCode(...new Uint8Array(buffer, at, 4));
    tables.set(name, { offset: view.getUint32(at + 8), length: view.getUint32(at + 12) });
  }
  const table = tables.get("name");
  if (!table || table.offset + 6 > view.byteLength) return null;
  const count = view.getUint16(table.offset + 2),
    strings = table.offset + view.getUint16(table.offset + 4);
  const names = new Map<number, string>();
  for (let i = 0; i < count; i++) {
    const at = table.offset + 6 + i * 12;
    if (at + 12 > view.byteLength) break;
    const platform = view.getUint16(at),
      language = view.getUint16(at + 4),
      id = view.getUint16(at + 6),
      length = view.getUint16(at + 8),
      offset = strings + view.getUint16(at + 10);
    if (offset + length > view.byteLength || ![1, 2, 4, 6, 16].includes(id)) continue;
    let value = "";
    if (platform === 3 || platform === 0) {
      if (platform === 3 && language !== 0x409 && names.has(id)) continue;
      for (let k = 0; k + 1 < length; k += 2)
        value += String.fromCharCode(view.getUint16(offset + k));
    } else if (platform === 1 && !names.has(id))
      value = String.fromCharCode(...new Uint8Array(buffer, offset, length));
    if (value) names.set(id, value);
  }
  const family = names.get(16) ?? names.get(1);
  if (!family) return null;
  const os2 = tables.get("OS/2");
  const weight =
    os2 && os2.offset + 6 <= view.byteLength ? view.getUint16(os2.offset + 4) || 400 : 400;
  return {
    family,
    aliases: [names.get(4), names.get(6)].filter((n): n is string => !!n && n !== family),
    weight,
    italic: /italic|oblique/i.test(names.get(2) ?? ""),
  };
}

async function registerFace(names: FontNames, data: ArrayBuffer) {
  for (const family of [names.family, ...names.aliases]) {
    const face = new FontFace(family, data.slice(0), {
      // Aliases (full and PostScript names) name one face, so they match any weight.
      weight: family === names.family ? String(names.weight) : "1 1000",
      style: names.italic ? "italic" : "normal",
    });
    document.fonts.add(await face.load());
    registered.set(family.toLowerCase(), family);
  }
}

/** Registers an imported TTF/OTF/WOFF/WOFF2 file and keeps it in local derived storage. */
export async function importFont(file: File): Promise<string> {
  if (file.size > 32 * 1024 * 1024) throw new Error("Font files must be smaller than 32 MiB.");
  if (!/\.(ttf|otf|woff2?)$/i.test(file.name))
    throw new Error("Choose a TTF, OTF, WOFF, or WOFF2 font file.");
  const data = await file.arrayBuffer();
  const names = fontNames(data) ?? {
    // WOFF names are compressed; the file name supplies the family.
    family: file.name.replace(/\.[^.]+$/, "").replace(/[-_](regular|normal)$/i, ""),
    aliases: [],
    weight: 400,
    italic: false,
  };
  await registerFace(names, data);
  const index = (await derivedCache<string[]>("fonts:index")) ?? [];
  const key = `font:${names.family}:${names.weight}:${names.italic ? "i" : "n"}`;
  await derivedCache(key, { names, data });
  if (!index.includes(key)) await derivedCache("fonts:index", [...index, key]);
  measured.clear();
  changed();
  return names.family;
}

let restored: Promise<string[]> | null = null;
/** Re-registers fonts imported in earlier sessions on this device. */
export function restoreFonts(): Promise<string[]> {
  if (typeof document === "undefined") return Promise.resolve([]);
  restored ??= (async () => {
    const families: string[] = [];
    for (const key of (await derivedCache<string[]>("fonts:index")) ?? []) {
      const entry = await derivedCache<{ names: FontNames; data: ArrayBuffer }>(key);
      if (!entry) continue;
      try {
        await registerFace(entry.names, entry.data);
        families.push(entry.names.family);
      } catch {
        /* A damaged stored font stays missing and is reported by preflight. */
      }
    }
    if (families.length) changed();
    return families;
  })();
  return restored;
}
export const importedFonts = () => [...new Set(registered.values())].sort();

// MARK: Drawing

const drawings = new Map<string, HTMLCanvasElement | null>();
export const forgetTextDrawings = () => drawings.clear();

/** The text as an image with its origin at 0,0, or null for empty text. Cached by request. */
export function drawText(request: TextRequest): HTMLCanvasElement | null {
  const key = JSON.stringify(request);
  if (drawings.has(key)) {
    const hit = drawings.get(key)!;
    drawings.delete(key);
    drawings.set(key, hit);
    return hit;
  }
  const image = draw(request);
  if (drawings.size >= 96) drawings.delete(drawings.keys().next().value!);
  drawings.set(key, image);
  return image;
}

interface Line {
  start: number;
  end: number;
  ascent: number;
  descent: number;
  width: number;
}

function draw(r: TextRequest): HTMLCanvasElement | null {
  if (!r.text || !(r.size > 0)) return null;
  const scratch = document.createElement("canvas").getContext("2d");
  if (!scratch) throw new Error("Canvas text drawing is unavailable.");
  const text = r.text;
  const newline = text.indexOf("\n");
  const firstLineEnd = newline < 0 ? text.length : newline;
  const scaled = r.firstLineScale !== 1 && firstLineEnd < text.length;
  const fontAt = (index: number) =>
    cssFont(r.font, scaled && index < firstLineEnd ? r.size * r.firstLineScale : r.size, r.weight);
  const metrics = (font: string) => {
    scratch.font = font;
    const m = scratch.measureText("");
    return { ascent: m.fontBoundingBoxAscent, descent: m.fontBoundingBoxDescent };
  };
  const width = (start: number, end: number) => {
    let total = 0;
    for (const [a, b] of splitAt(start, end, scaled ? [firstLineEnd] : [])) {
      scratch.font = fontAt(a);
      total += scratch.measureText(text.slice(a, b)).width;
    }
    return total;
  };

  // Greedy breaking at spaces, then characters for a word wider than a line, like Core Text.
  const limit = Math.max(r.maxWidth, r.size);
  const ranges: [number, number][] = [];
  let paragraph = 0;
  for (const piece of text.split("\n")) {
    const end = paragraph + piece.length;
    let start = paragraph;
    while (start < end) {
      let fit = start,
        cursor = start;
      while (cursor < end) {
        let next = cursor;
        while (next < end && text[next] !== " ") next++;
        while (next < end && text[next] === " ") next++;
        if (fit > start && width(start, trimEnd(text, start, next)) > limit) break;
        fit = next;
        cursor = next;
      }
      if (width(start, trimEnd(text, start, fit)) > limit) {
        fit = start + 1;
        while (fit < end && width(start, fit + 1) <= limit) fit++;
      }
      ranges.push([start, fit]);
      start = fit;
    }
    if (piece.length === 0) ranges.push([paragraph, paragraph]);
    paragraph = end + 1;
  }
  const base = metrics(cssFont(r.font, r.size, r.weight));
  const lines: Line[] = ranges.map(([start, end]) => {
    if (start === end) return { start, end, ...base, width: 0 };
    const fonts = splitAt(start, end, scaled ? [firstLineEnd] : []).map(([a]) =>
      metrics(fontAt(a)),
    );
    return {
      start,
      end,
      ascent: Math.max(...fonts.map((m) => m.ascent)),
      descent: Math.max(...fonts.map((m) => m.descent)),
      width: Math.max(0, width(start, trimEnd(text, start, end))),
    };
  });
  if (!lines.length) return null;

  const gap = r.lineSpacing * r.size;
  const blockWidth = Math.max(...lines.map((l) => l.width));
  const blockHeight =
    lines.reduce((sum, l) => sum + l.ascent + l.descent, 0) + gap * (lines.length - 1);
  const size = r.size;
  const boxX = r.backgroundColor ? size * 0.35 : 0,
    boxY = r.backgroundColor ? size * 0.18 : 0;
  const pad = Math.ceil(r.strokeWidth + (r.shadow ? size * 0.3 : 0) + 2);
  const canvasWidth = Math.ceil(blockWidth + 2 * boxX + 2 * pad),
    canvasHeight = Math.ceil(blockHeight + 2 * boxY + 2 * pad);
  if (canvasWidth <= 0 || canvasHeight <= 0 || canvasWidth >= 16_384 || canvasHeight >= 16_384)
    return null;
  const canvas = document.createElement("canvas");
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas text drawing is unavailable.");
  const shadow = (target: CanvasRenderingContext2D) => {
    target.shadowColor = "rgba(0,0,0,0.6)";
    target.shadowOffsetX = 0;
    target.shadowOffsetY = size * 0.04;
    target.shadowBlur = size * 0.12;
  };
  if (r.backgroundColor) {
    ctx.save();
    if (r.shadow) shadow(ctx);
    ctx.fillStyle = css(r.backgroundColor);
    ctx.beginPath();
    ctx.roundRect(pad, pad, blockWidth + 2 * boxX, blockHeight + 2 * boxY, size * 0.22);
    ctx.fill();
    ctx.restore();
  }
  // Stroke and fill share one layer so they cast one shadow.
  const layered = r.shadow && !r.backgroundColor;
  const layer = layered ? document.createElement("canvas") : canvas;
  if (layered) {
    layer.width = canvasWidth;
    layer.height = canvasHeight;
  }
  const out = layered ? layer.getContext("2d")! : ctx;
  out.lineJoin = "round";
  out.textBaseline = "alphabetic";
  const stroke = r.strokeWidth > 0 && r.strokeColor ? r.strokeColor : null;
  const visible = r.visibleLength ?? text.length;
  const fill = (index: number) =>
    r.highlight && index >= r.highlight[0] && index < r.highlight[1]
      ? r.highlightColor
      : r.firstLineColor && firstLineEnd < text.length && index < firstLineEnd
        ? r.firstLineColor
        : r.color;
  const cuts = [
    ...(scaled || (r.firstLineColor && firstLineEnd < text.length) ? [firstLineEnd] : []),
    ...(r.highlight ?? []),
    ...(r.visibleLength != null ? [r.visibleLength] : []),
  ];
  let top = pad + boxY;
  for (const line of lines) {
    const align = r.alignment.toLowerCase();
    const x0 =
      align === "left" || align === "leading"
        ? pad + boxX
        : align === "right" || align === "trailing"
          ? pad + boxX + blockWidth - line.width
          : pad + boxX + (blockWidth - line.width) / 2;
    const baseline = top + line.ascent;
    const runs = splitAt(line.start, line.end, cuts);
    for (const pass of stroke ? ["stroke", "fill"] : ["fill"]) {
      let x = x0;
      for (const [a, b] of runs) {
        out.font = fontAt(a);
        const piece = text.slice(a, b);
        if (a < visible) {
          if (pass === "stroke") {
            out.strokeStyle = css(stroke!);
            out.lineWidth = 2 * r.strokeWidth;
            out.strokeText(piece, x, baseline);
          } else {
            out.fillStyle = css(fill(a));
            out.fillText(piece, x, baseline);
          }
        }
        x += out.measureText(piece).width;
      }
    }
    top += line.ascent + line.descent + gap;
  }
  if (layered) {
    ctx.save();
    shadow(ctx);
    ctx.drawImage(layer, 0, 0);
    ctx.restore();
  }
  return canvas;
}

function trimEnd(text: string, start: number, end: number) {
  while (end > start && text[end - 1] === " ") end--;
  return end;
}
/** [start, end) split at every cut strictly inside it. */
function splitAt(start: number, end: number, cuts: readonly number[]): [number, number][] {
  const points = [...new Set(cuts.filter((c) => c > start && c < end))].sort((a, b) => a - b);
  const result: [number, number][] = [];
  let at = start;
  for (const point of [...points, end]) {
    if (point > at) result.push([at, point]);
    at = point;
  }
  return result.length ? result : [[start, end]];
}
