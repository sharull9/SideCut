// Ported from TandemCore/TextStyles.swift, TandemRender/TitlePresets.swift,
// TandemRender/TextRenderer.swift (TextAnimationState) and TandemRender/ProjectFonts.swift.
// See tests/fixtures/tandem/TANDEM-LICENSE.
import type { Clip, Project } from "@sidecut/contracts/project";
import { easing } from "./keyframes";

export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}
export interface TextStyle {
  font?: string;
  size?: number;
  weight?: number;
  color?: RGBA;
  strokeColor?: RGBA;
  strokeWidth?: number;
  backgroundColor?: RGBA;
  alignment?: string;
  uppercase?: boolean;
  shadow?: boolean;
  lineSpacing?: number;
}
export interface ResolvedStyle {
  font: string;
  size: number;
  weight: number;
  color: RGBA;
  strokeColor: RGBA | null;
  strokeWidth: number;
  backgroundColor: RGBA | null;
  alignment: string;
  uppercase: boolean;
  shadow: boolean;
  lineSpacing: number;
}
export interface TimedWord {
  text: string;
  start: number;
  end: number;
}
export interface TextContent {
  text: string;
  preset?: string;
  style: TextStyle;
  animationIn?: string;
  animationOut?: string;
  animationDuration?: number;
  words?: TimedWord[];
}
export const STYLE_FIELDS = [
  "font",
  "size",
  "weight",
  "color",
  "strokeColor",
  "strokeWidth",
  "backgroundColor",
  "alignment",
  "uppercase",
  "shadow",
  "lineSpacing",
] as const;
const COLOR_FIELDS = new Set(["color", "strokeColor", "backgroundColor"]);
const NUMBER_FIELDS = new Set(["size", "weight", "strokeWidth", "lineSpacing"]);
const BOOLEAN_FIELDS = new Set(["uppercase", "shadow"]);
export const DEFAULT_ANIMATION_DURATION = 0.4;
const white: RGBA = { r: 1, g: 1, b: 1, a: 1 };
const black: RGBA = { r: 0, g: 0, b: 0, a: 1 };
const accent: RGBA = { r: 1, g: 0.8, b: 0.16, a: 1 };

/** What each field is when neither the clip nor its preset sets it. */
export const DEFAULT_TEXT_STYLE: ResolvedStyle = {
  font: "SF Pro Display",
  size: 64,
  weight: 800,
  color: white,
  strokeColor: null,
  strokeWidth: 0,
  backgroundColor: null,
  alignment: "center",
  uppercase: false,
  shadow: false,
  lineSpacing: 0,
};

export interface TitlePreset {
  id: string;
  name: string;
  summary: string;
  style: TextStyle;
  /** Where the preset's font comes from when the device lacks it. */
  fontAsset?: string;
  animationIn?: string;
  animationOut?: string;
  animationDuration: number;
  position: { x: number; y: number };
  highlightColor?: RGBA;
  firstLineScale?: number;
  firstLineColor?: RGBA;
}
const centre = { x: 0.5, y: 0.5 };
export const TITLE_PRESETS: readonly TitlePreset[] = [
  {
    id: "label",
    name: "Label",
    summary: "Plain label such as JAMIES SCREEN, 8x or VS.",
    style: { size: 64, weight: 800, uppercase: true, shadow: true },
    animationIn: "fade",
    animationOut: "fade",
    animationDuration: 0.25,
    position: centre,
  },
  {
    id: "callout",
    name: "Pop callout",
    summary: "Punchy boxed callout such as 14 TIPS or FULL VIDEO LINKED BELOW.",
    style: {
      size: 88,
      weight: 900,
      color: { r: 0.07, g: 0.07, b: 0.07, a: 1 },
      backgroundColor: accent,
      uppercase: true,
      shadow: true,
    },
    animationIn: "pop",
    animationOut: "pop",
    animationDuration: 0.35,
    position: centre,
  },
  {
    id: "sectionHeader",
    name: "Section header",
    summary: "Two lines: a small accent line over a big title, such as TIP 1 / CURSOR DOCS.",
    style: { size: 104, weight: 900, uppercase: true, shadow: true, lineSpacing: 0.05 },
    animationIn: "slideUp",
    animationOut: "fade",
    animationDuration: 0.45,
    position: centre,
    firstLineScale: 0.55,
    firstLineColor: accent,
  },
  {
    id: "version",
    name: "Version number",
    summary: "Big version number at the start of a release video, such as v1.46.0.",
    style: { size: 170, weight: 900, shadow: true },
    animationIn: "pop",
    animationOut: "fade",
    animationDuration: 0.4,
    position: centre,
  },
  {
    id: "caption",
    name: "Word caption",
    summary: "Short-form caption that highlights each word as it's spoken.",
    style: { font: "Tilt Warp", size: 72, weight: 400, strokeColor: black, strokeWidth: 6 },
    animationIn: "fade",
    animationOut: "fade",
    animationDuration: 0.1,
    position: { x: 0.5, y: 0.42 },
    highlightColor: { r: 1, g: 0.84, b: 0.2, a: 1 },
    fontAsset: "fontsource:tilt-warp",
  },
];
export const presetFor = (id: string | null | undefined) =>
  id == null ? undefined : TITLE_PRESETS.find((p) => p.id.toLowerCase() === id.toLowerCase());

/** Every field filled in: this style over `base`. A see-through box or outline counts as none. */
export function resolveStyle(
  style: TextStyle,
  base: ResolvedStyle = DEFAULT_TEXT_STYLE,
): ResolvedStyle {
  const result: ResolvedStyle = {
    font: style.font ?? base.font,
    size: style.size ?? base.size,
    weight: style.weight ?? base.weight,
    color: style.color ?? base.color,
    strokeColor: style.strokeColor ?? base.strokeColor,
    strokeWidth: style.strokeWidth ?? base.strokeWidth,
    backgroundColor: style.backgroundColor ?? base.backgroundColor,
    alignment: style.alignment ?? base.alignment,
    uppercase: style.uppercase ?? base.uppercase,
    shadow: style.shadow ?? base.shadow,
    lineSpacing: style.lineSpacing ?? base.lineSpacing,
  };
  if (result.backgroundColor && result.backgroundColor.a <= 0) result.backgroundColor = null;
  if (result.strokeColor && result.strokeColor.a <= 0) result.strokeColor = null;
  return result;
}
/** What a clip gets from its preset alone: what a field returns to when the clip unsets it. */
export const presetStyle = (presetID: string | null | undefined) =>
  resolveStyle(presetFor(presetID)?.style ?? {});
export const styleFor = (content: TextContent) =>
  resolveStyle(content.style, presetStyle(content.preset));

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v);
function colorIssue(value: unknown): string | null {
  if (!isObject(value)) return "a color object";
  for (const key of ["r", "g", "b", "a"]) {
    const channel = value[key] ?? (key === "a" ? 1 : undefined);
    if (typeof channel !== "number" || !Number.isFinite(channel) || channel < 0 || channel > 1)
      return "color components from 0 to 1";
  }
  return null;
}
const color = (value: Json): RGBA => ({
  r: value.r as number,
  g: value.g as number,
  b: value.b as number,
  a: typeof value.a === "number" ? value.a : 1,
});

/** Why a text clip's content cannot be drawn, or null. Unknown fields are preserved, not checked. */
export function textIssue(content: unknown): string | null {
  if (!isObject(content) || typeof content.text !== "string") return "Text clips need text.";
  if (content.preset != null && typeof content.preset !== "string")
    return "Text preset must be a name.";
  for (const key of ["animationIn", "animationOut"])
    if (content[key] != null && typeof content[key] !== "string")
      return `Text ${key} must be an animation name.`;
  const animation = content.animationDuration;
  if (animation != null && (typeof animation !== "number" || !(animation >= 0)))
    return "Text animationDuration must be zero or more seconds.";
  if (content.style != null && !isObject(content.style)) return "Text style must be an object.";
  const style = (content.style ?? {}) as Json;
  for (const field of STYLE_FIELDS) {
    const value = style[field];
    if (value == null) continue;
    if (COLOR_FIELDS.has(field)) {
      const issue = colorIssue(value);
      if (issue) return `Text style ${field} needs ${issue}.`;
    } else if (NUMBER_FIELDS.has(field)) {
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
        return `Text style ${field} must be a number of zero or more.`;
    } else if (BOOLEAN_FIELDS.has(field)) {
      if (typeof value !== "boolean") return `Text style ${field} must be true or false.`;
    } else if (typeof value !== "string") return `Text style ${field} must be text.`;
  }
  if (typeof style.size === "number" && style.size > 2000)
    return "Text style size must be at most 2000.";
  if (content.words != null) {
    if (!Array.isArray(content.words)) return "Caption words must be a list.";
    for (const word of content.words)
      if (
        !isObject(word) ||
        typeof word.text !== "string" ||
        typeof word.start !== "number" ||
        typeof word.end !== "number" ||
        !(word.start >= 0) ||
        !(word.end >= word.start)
      )
        return "Caption words need text and clip-relative start/end seconds.";
  }
  return null;
}

/** The typed text content of a clip, or null for other content. Throws for undrawable content. */
export function textContent(clip: Pick<Clip, "content">): TextContent | null {
  const raw = clip.content.text as unknown;
  if (raw == null) return null;
  const issue = textIssue(raw);
  if (issue) throw new Error(issue);
  const value = raw as Json;
  const style: TextStyle = {};
  const source = (value.style ?? {}) as Json;
  for (const field of STYLE_FIELDS) {
    const v = source[field];
    if (v == null) continue;
    (style as Json)[field] = COLOR_FIELDS.has(field) ? color(v as Json) : v;
  }
  return {
    text: value.text as string,
    style,
    ...(typeof value.preset === "string" ? { preset: value.preset } : {}),
    ...(typeof value.animationIn === "string" ? { animationIn: value.animationIn } : {}),
    ...(typeof value.animationOut === "string" ? { animationOut: value.animationOut } : {}),
    ...(typeof value.animationDuration === "number"
      ? { animationDuration: value.animationDuration }
      : {}),
    ...(Array.isArray(value.words) ? { words: value.words as TimedWord[] } : {}),
  };
}

export type TextAnimation = "fade" | "pop" | "slideUp" | "typewriter";
/** Accepts reference names; `none` or an unknown name is no animation, switching a preset's off. */
export function textAnimation(name: string | null | undefined): TextAnimation | null {
  switch (name?.toLowerCase()) {
    case "fade":
    case "fadein":
    case "fadeout":
    case "dissolve":
      return "fade";
    case "pop":
    case "popin":
    case "popout":
    case "scale":
      return "pop";
    case "slide":
    case "slideup":
    case "slideupin":
    case "rise":
      return "slideUp";
    case "typewriter":
    case "type":
    case "typing":
      return "typewriter";
    default:
      return null;
  }
}
export const ANIMATION_NAMES = ["none", "fade", "pop", "slideUp", "typewriter"] as const;

export interface ResolvedText {
  text: string;
  style: ResolvedStyle;
  animationIn: TextAnimation | null;
  animationOut: TextAnimation | null;
  animationDuration: number;
  position: { x: number; y: number } | null;
  highlightColor: RGBA;
  firstLineScale: number;
  firstLineColor: RGBA | null;
  words: TimedWord[] | null;
}
/** A text clip with its preset merged in. */
export function resolveText(content: TextContent): ResolvedText {
  const preset = presetFor(content.preset);
  const style = styleFor(content);
  const words = content.words?.length ? content.words : null;
  const text = words ? words.map((w) => w.text).join(" ") : content.text;
  return {
    text: style.uppercase ? text.toUpperCase() : text,
    style,
    animationIn: textAnimation(content.animationIn ?? preset?.animationIn),
    animationOut: textAnimation(content.animationOut ?? preset?.animationOut),
    animationDuration:
      content.animationDuration ?? preset?.animationDuration ?? DEFAULT_ANIMATION_DURATION,
    position: preset?.position ?? null,
    highlightColor: preset?.highlightColor ?? presetFor("caption")!.highlightColor!,
    firstLineScale: preset?.firstLineScale ?? 1,
    firstLineColor: preset?.firstLineColor ?? null,
    words,
  };
}
/** The word being spoken: the last one that has started, so the highlight doesn't flicker in gaps. */
export function currentWord(text: ResolvedText, clipTime: number): number | null {
  if (!text.words) return null;
  const index = text.words.findLastIndex(
    (w) => Math.round(w.start * 48_000) <= Math.round(clipTime * 48_000),
  );
  return index < 0 ? null : index;
}
/** UTF-16 range of word `index` in the resolved text. */
export function wordRange(text: ResolvedText, index: number): [number, number] | null {
  const words = text.words;
  if (!words || index < 0 || index >= words.length) return null;
  const length = (i: number) =>
    (text.style.uppercase ? words[i]!.text.toUpperCase() : words[i]!.text).length;
  let start = 0;
  for (let i = 0; i < index; i++) start += length(i) + 1;
  return [start, start + length(index)];
}

export interface AnimationState {
  opacity: number;
  scale: number;
  /** Vertical offset as a fraction of canvas height, down positive. */
  offsetY: number;
  visibleFraction: number;
}
/** Overshoots to about 1.1 before settling at 1. */
export function easeOutBack(p: number) {
  const c1 = 1.70158,
    c3 = c1 + 1,
    x = Math.min(Math.max(p, 0), 1) - 1;
  return 1 + c3 * x ** 3 + c1 * x ** 2;
}
/** The in and out animation state at a clip-relative time. */
export function animationState(
  clipTime: number,
  clipDuration: number,
  text: Pick<ResolvedText, "animationIn" | "animationOut" | "animationDuration">,
): AnimationState {
  const state: AnimationState = { opacity: 1, scale: 1, offsetY: 0, visibleFraction: 1 };
  const length = Math.min(text.animationDuration, clipDuration / 2);
  if (!(length > 0)) return state;
  const entering = clipTime / length,
    leaving = (clipDuration - clipTime) / length;
  const apply = (animation: TextAnimation, p: number, isEntering: boolean) => {
    switch (animation) {
      case "fade":
        state.opacity *= easing("easeInOut", p);
        break;
      case "pop":
        state.scale *= easeOutBack(p);
        state.opacity *= Math.min(1, p * 4);
        break;
      case "slideUp": {
        const eased = 1 - (1 - p) ** 3;
        state.offsetY += (isEntering ? 1 : -1) * (1 - eased) * 0.06;
        state.opacity *= eased;
        break;
      }
      case "typewriter":
        state.visibleFraction = Math.min(state.visibleFraction, p);
    }
  };
  if (text.animationIn && entering < 1) apply(text.animationIn, Math.max(entering, 0), true);
  if (text.animationOut && leaving < 1) apply(text.animationOut, Math.max(leaving, 0), false);
  return state;
}

// MARK: Fonts

const SYSTEM_NAMES = new Set([
  "",
  "system",
  "system-ui",
  "-apple-system",
  "sf pro",
  "sf pro display",
  "sf pro text",
  "san francisco",
]);
/** Names that mean the system font (SF Pro in the reference). */
export const isSystemFont = (name: string) => SYSTEM_NAMES.has(name.toLowerCase());

/** The Fontsource asset ID a font's name suggests: `Tilt Warp` and `TiltWarp-Regular` are `fontsource:tilt-warp`. */
export function fontsourceID(name: string): string {
  let family = name;
  if (!family.includes(" ") && family.includes("-")) {
    family = family.slice(0, family.indexOf("-"));
    let spaced = "";
    for (const character of family) {
      const last = spaced.at(-1);
      if (spaced && /\p{Lu}/u.test(character) && last !== undefined && /[\p{Ll}\p{N}]/u.test(last))
        spaced += " ";
      spaced += character;
    }
    family = spaced;
  }
  return `fontsource:${family
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .join("-")}`;
}

export interface MissingFont {
  name: string;
  clipIDs: string[];
  presetID: string | null;
  assetID: string;
}
export function missingFontWarning(font: MissingFont, count = font.clipIDs.length) {
  const whose = font.presetID ? `, the ${font.presetID} preset's font,` : "";
  const what = count === 1 ? "1 text clip is" : `${count} text clips are`;
  return `${font.name}${whose} isn't available, so ${what} drawn in the system font instead. Import its font file from a title's Text tab, or install ${font.assetID}.`;
}
/** Fonts the project's titles name that `isAvailable` cannot draw, in timeline order per track. */
export function missingFonts(
  project: Project,
  isAvailable: (name: string) => boolean,
  drawnOnly = false,
): MissingFont[] {
  const found = new Map<string, MissingFont>();
  for (const track of project.videoTracks) {
    if (drawnOnly && track.hidden) continue;
    for (const clip of track.clips) {
      if (clip.content.text == null || (drawnOnly && !clip.enabled)) continue;
      let content: TextContent | null;
      try {
        content = textContent(clip);
      } catch {
        continue;
      }
      if (!content) continue;
      const name = styleFor(content).font,
        key = name.toLowerCase();
      const existing = found.get(key);
      if (existing) {
        existing.clipIDs.push(clip.id);
        continue;
      }
      const preset = presetFor(content.preset);
      const fromPreset = preset?.style.font?.toLowerCase() === key ? preset : undefined;
      found.set(key, {
        name,
        clipIDs: [clip.id],
        presetID: fromPreset?.id ?? null,
        assetID: fromPreset?.fontAsset ?? fontsourceID(name),
      });
    }
  }
  return [...found.values()].filter((font) => !isSystemFont(font.name) && !isAvailable(font.name));
}
