// Ported from TandemCore/SectionCard.swift and TandemCore/SectionCardEditing.swift.
// See tests/fixtures/tandem/TANDEM-LICENSE.
import { Schema } from "effect";
import {
  TrackSchema,
  markerKind,
  type Clip,
  type Marker,
  type Project,
} from "@sidecut/contracts/project";
import type { EditCommand } from "@sidecut/contracts/commands";
import { Time, flicksPerFrame, type FrameRate } from "@sidecut/contracts/time";
import {
  clearRange,
  end,
  insertionPoint,
  openTime,
  replace,
  requireTrack,
  sorted,
  tracks,
  unlocked,
  type EditContext,
} from "./timeline-editing";

export const SECTION_CARD = "sectionCard";
export const DEFAULT_CARD_DURATION = 3.2;
export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}
const hex = (value: number): RGBA => ({
  r: ((value >> 16) & 0xff) / 255,
  g: ((value >> 8) & 0xff) / 255,
  b: (value & 0xff) / 255,
  a: 1,
});
export function parseHex(text: string): RGBA | null {
  const value = text.trim().replace(/^#/, "");
  return /^[0-9a-f]{6}$/i.test(value) ? hex(parseInt(value, 16)) : null;
}
export const hexString = (c: RGBA) =>
  `#${[c.r, c.g, c.b]
    .map((v) =>
      Math.round(Math.min(Math.max(v, 0), 1) * 255)
        .toString(16)
        .padStart(2, "0")
        .toUpperCase(),
    )
    .join("")}`;
const sameColor = (a: RGBA, b: RGBA) => a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;

export interface CardColors {
  accent: RGBA;
  band2: RGBA;
  band3: RGBA;
  background: RGBA;
}
/** Convex's yellow #F3B01C, red #EE342F and purple #8D2676 on #141418. */
export const CONVEX: CardColors = {
  accent: hex(0xf3b01c),
  band2: hex(0xee342f),
  band3: hex(0x8d2676),
  background: hex(0x141418),
};
export interface CardProps {
  title: string;
  subtitle: string;
  number: string;
  total: number;
  kicker: string;
  colors: CardColors;
  cursor: boolean;
}
export const numberText = (value: number) =>
  value >= 0 && value < 10 ? `0${value}` : String(value);
const numberString = (value: number) =>
  Number.isInteger(value) && Math.abs(value) < 1e15 ? String(value) : String(value);

export function cardProps(partial: Partial<CardProps> = {}): CardProps {
  return {
    title: "",
    subtitle: "",
    number: "",
    kicker: "",
    colors: CONVEX,
    cursor: true,
    ...partial,
    total: Math.max(0, partial.total ?? 0),
  };
}
const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

/** Card props read leniently from `GraphicContent.props`, as the reference does. */
export function readCardProps(props: unknown): CardProps {
  const values = isObject(props) ? props : {};
  const text = (key: string) => {
    const v = values[key];
    return typeof v === "string"
      ? v
      : typeof v === "number"
        ? numberString(v)
        : typeof v === "boolean"
          ? v
            ? "true"
            : ""
          : "";
  };
  const colour = (key: string, fallback: RGBA): RGBA => {
    const v = values[key];
    if (isObject(v) && ["r", "g", "b"].every((k) => typeof v[k] === "number"))
      return {
        r: v.r as number,
        g: v.g as number,
        b: v.b as number,
        a: typeof v.a === "number" ? v.a : 1,
      };
    return (typeof v === "string" && parseHex(v)) || fallback;
  };
  let number = text("number");
  const rawNumber = values.number;
  if (
    typeof rawNumber === "number" &&
    Number.isInteger(rawNumber) &&
    rawNumber >= 0 &&
    rawNumber < 1000
  )
    number = numberText(rawNumber);
  let total = 0;
  const rawTotal = values.total;
  if (typeof rawTotal === "number")
    total = Number.isFinite(rawTotal) ? Math.round(Math.max(0, Math.min(rawTotal, 999))) : 0;
  else if (typeof rawTotal === "string" && /^[+-]?\d+$/.test(rawTotal.trim()))
    total = Number(rawTotal.trim());
  let cursor = true;
  const rawCursor = values.cursor;
  if (typeof rawCursor === "boolean") cursor = rawCursor;
  else if (typeof rawCursor === "number") cursor = rawCursor !== 0;
  else if (typeof rawCursor === "string")
    cursor = !["false", "off", "no", "0", "none"].includes(rawCursor.trim().toLowerCase());
  return cardProps({
    title: text("title"),
    subtitle: text("subtitle"),
    number,
    total,
    kicker: text("kicker"),
    colors: {
      accent: colour("accent", CONVEX.accent),
      band2: colour("band2", CONVEX.band2),
      band3: colour("band3", CONVEX.band3),
      background: colour("background", CONVEX.background),
    },
    cursor,
  });
}
/** As `GraphicContent.props`: defaults are left out, so a card only says what is its own. */
export function cardParams(props: CardProps): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (props.title) result.title = props.title;
  if (props.subtitle) result.subtitle = props.subtitle;
  if (props.number) result.number = props.number;
  if (props.total > 0) result.total = props.total;
  if (props.kicker) result.kicker = props.kicker;
  for (const key of ["accent", "band2", "band3", "background"] as const)
    if (!sameColor(props.colors[key], CONVEX[key])) result[key] = props.colors[key];
  if (!props.cursor) result.cursor = false;
  return result;
}
export const cardContent = (props: CardProps) => ({
  graphic: { template: SECTION_CARD, props: cardParams(props) },
});
export function cardOf(clip: Pick<Clip, "content">): CardProps | null {
  const graphic = clip.content.graphic as { template?: unknown; props?: unknown } | undefined;
  return graphic?.template === SECTION_CARD ? readCardProps(graphic.props) : null;
}

/** The number as a whole number, when it is one ("01" is 1). */
export function cardIndex(props: CardProps): number | null {
  const digits = props.number.trim();
  if (!/^\d+$/.test(digits)) return null;
  const value = Number(digits);
  return value > 0 ? value : null;
}
/** The words beside the chip, like "Section 1 of 3". */
export function kickerLine(props: CardProps): string | null {
  const word = props.kicker.trim();
  if (!word) return null;
  const index = cardIndex(props);
  if (index == null) return word;
  return props.total > 0 ? `${word} ${index} of ${props.total}` : `${word} ${index}`;
}
export const MAX_BARS = 6;
export type CardProgress =
  | { kind: "bars"; count: number; lit: number }
  | { kind: "proportional"; index: number; total: number };
export function cardProgress(props: CardProps): CardProgress | null {
  const index = cardIndex(props);
  if (!(props.total > 0) || index == null || index > props.total) return null;
  return props.total <= MAX_BARS
    ? { kind: "bars", count: props.total, lit: index }
    : { kind: "proportional", index, total: props.total };
}
export function cardLabel(props: CardProps) {
  const text = [props.number, props.title]
    .map((p) => p.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\n/g, " ");
  return text || "Section card";
}
/** The words a viewer reads: title, subtitle and kicker line, single-spaced. */
export const readingText = (props: CardProps) =>
  [props.title, props.subtitle, kickerLine(props) ?? ""]
    .flatMap((part) => part.split(/\s+/).filter(Boolean))
    .join(" ");

export const READING = {
  charactersPerSecond: 15,
  wipes: 1.4,
  settle: 0.8,
  shortest: 4,
  longest: 7,
};
/** The length a card needs for its words, kept to 4-7 s, rounded up to a tenth and a frame. */
export function fittedDuration(props: CardProps, rate?: FrameRate): Time {
  const reading =
    READING.wipes + READING.settle + [...readingText(props)].length / READING.charactersPerSecond;
  const clamped = Math.min(Math.max(reading, READING.shortest), READING.longest);
  const tenths = Math.ceil(clamped * 10 - 1e-9) / 10;
  if (!rate) return Time.fromSeconds(tenths);
  const frames = Math.ceil((tenths * rate.numerator) / rate.denominator - 1e-6);
  return Time.frames(BigInt(frames), rate);
}

/** A CSS `cubic-bezier(x1, y1, x2, y2)` timing function. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number) {
  const curve = (a: number, b: number, t: number) => {
    const u = 1 - t;
    return 3 * u * u * t * a + 3 * u * t * t * b + t * t * t;
  };
  const slope = (a: number, b: number, t: number) => {
    const u = 1 - t;
    return 3 * u * u * a + 6 * u * t * (b - a) + 3 * t * t * (1 - b);
  };
  const parameter = (x: number) => {
    let t = x;
    for (let i = 0; i < 8; i++) {
      const error = curve(x1, x2, t) - x;
      if (Math.abs(error) < 1e-9) return t;
      const d = slope(x1, x2, t);
      if (Math.abs(d) < 1e-6) break;
      t -= error / d;
    }
    let lower = 0,
      upper = 1;
    t = x;
    for (let i = 0; i < 60; i++) {
      const value = curve(x1, x2, t);
      if (Math.abs(value - x) < 1e-9) return t;
      if (value < x) lower = t;
      else upper = t;
      t = (lower + upper) / 2;
    }
    return t;
  };
  return (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : curve(y1, y2, parameter(x)));
}

export interface Band {
  left: number;
  lean: number;
  aspect: number;
}
export const leftEdge = (band: Band, y: number) => band.left + band.lean * (0.5 - y / band.aspect);
export const rightEdge = (band: Band, y: number) => leftEdge(band, y) + MOTION.bandWidth;
export const MOTION = {
  sweep: 0.72,
  stagger: 0.08,
  outLead: 0.88,
  contentStart: 0.52,
  contentLength: 0.45,
  bandWidth: 0.46,
  bandLeft: -0.62,
  skewDegrees: 16,
  contentRise: 0.025,
  contentScale: 0.98,
  cursorBlink: 0.53,
};
const sweepEasing = cubicBezier(0.65, 0, 0.35, 1);
const contentEasing = cubicBezier(0.16, 1, 0.3, 1);

/** How a card moves, in seconds from its start and widths of the frame (x right, y down). */
export class CardMotion {
  readonly duration: number;
  readonly aspect: number;
  constructor(duration: number, aspect = 9 / 16) {
    this.duration = Math.max(0, duration);
    this.aspect = aspect > 0 ? aspect : 9 / 16;
  }
  static of(duration: number, width: number, height: number) {
    return new CardMotion(duration, width > 0 && height > 0 ? height / width : 9 / 16);
  }
  get timeScale() {
    const both = 2 * MOTION.outLead;
    return this.duration >= both ? 1 : this.duration / both;
  }
  get sweepLength() {
    return MOTION.sweep * this.timeScale;
  }
  inStart(index: number) {
    return index * MOTION.stagger * this.timeScale;
  }
  outStart(index: number) {
    return this.duration - (MOTION.outLead - index * MOTION.stagger) * this.timeScale;
  }
  get lean() {
    return Math.tan((MOTION.skewDegrees * Math.PI) / 180) * this.aspect;
  }
  get restLeft() {
    return Math.min(MOTION.bandLeft, -(MOTION.bandWidth + this.lean / 2) - 0.005);
  }
  get travel() {
    return Math.max(3.72 * MOTION.bandWidth, 1 - this.restLeft + this.lean / 2 + 0.005);
  }
  band(start: number, t: number): Band | null {
    const length = this.sweepLength;
    if (!(length > 0) || t < start || t >= start + length) return null;
    return {
      left: this.restLeft + sweepEasing((t - start) / length) * this.travel,
      lean: this.lean,
      aspect: this.aspect,
    };
  }
  /** Bands of the sweep in and out on screen at `t`, first band first. */
  bands(t: number): { index: number; band: Band }[] {
    const result: { index: number; band: Band }[] = [];
    for (const start of [(i: number) => this.inStart(i), (i: number) => this.outStart(i)])
      for (let index = 0; index < 3; index++) {
        const band = this.band(start(index), t);
        if (band) result.push({ index, band });
      }
    return result;
  }
  /** Where the card shows: left of the first in-band, right of the last out-band. */
  reveal(t: number): { before: Band | null; after: Band | null; hidden: boolean } {
    const hidden = { before: null, after: null, hidden: true };
    if (t < 0 || t >= this.duration || t < this.inStart(0)) return hidden;
    const last = this.outStart(2);
    if (t >= last + this.sweepLength) return hidden;
    return { before: this.band(this.inStart(0), t), after: this.band(last, t), hidden: false };
  }
  contentProgress(t: number) {
    const start = MOTION.contentStart * this.timeScale,
      length = MOTION.contentLength * this.timeScale;
    return length > 0 ? contentEasing((t - start) / length) : 1;
  }
  get cursorLands() {
    return (MOTION.contentStart + MOTION.contentLength) * this.timeScale;
  }
  cursorLit(t: number) {
    const stop = this.outStart(0);
    if (t < MOTION.contentStart * this.timeScale || t >= stop) return false;
    const lands = this.cursorLands;
    if (t < lands) return true;
    const spell = Math.floor((t - lands) / MOTION.cursorBlink);
    if (spell % 2 !== 0) return false;
    return spell === 0 || stop - (lands + spell * MOTION.cursorBlink) >= MOTION.cursorBlink / 2;
  }
  /** When the card first hides the whole frame and when the next shot first shows. */
  get covered(): [number, number] | null {
    const steps = 400;
    const first = (lower: number, upper: number, test: (t: number) => boolean) => {
      let previous = lower;
      for (let step = 0; step <= steps; step++) {
        const t = lower + ((upper - lower) * step) / steps;
        if (test(t)) {
          let a = previous,
            b = t;
          for (let i = 0; i < 30; i++) {
            const m = (a + b) / 2;
            if (test(m)) b = m;
            else a = m;
          }
          return b;
        }
        previous = t;
      }
      return null;
    };
    const inStart = this.inStart(0),
      outStart = this.outStart(2),
      length = this.sweepLength;
    const start = first(inStart, inStart + length, (t) => {
      const band = this.band(inStart, t);
      return band ? rightEdge(band, this.aspect) >= 1 : t >= inStart + length;
    });
    if (start == null) return null;
    const stop =
      first(outStart, outStart + length, (t) => {
        const band = this.band(outStart, t);
        return band ? leftEdge(band, 0) > 0 : t >= outStart + length;
      }) ?? this.duration;
    return stop > start ? [start, stop] : null;
  }
}

// MARK: Editing

export const SOUND_GAIN_DB = -15;
export const SOUND_IN_OFFSET = 0.2;
export const MAX_CUT_SHIFT = 0.3;

export interface CardPlacement {
  marker: Marker;
  number: string;
  start: Time;
  duration: Time;
  existingClipID: string | null;
  cut: Time;
  cutReach: Time;
}
const contains = (clip: Clip, time: Time) =>
  clip.start.flicks <= time.flicks && time.flicks < end(clip).flicks;
export function existingCard(time: Time, p: Project): Clip | null {
  for (const track of p.videoTracks) {
    const clip = track.clips.find((c) => cardOf(c) && contains(c, time));
    if (clip) return clip;
  }
  return null;
}
export function coverage(duration: Time, p: Project): [number, number] {
  if (duration.seconds < 1) throw new Error("A section card needs at least 1 s.");
  const covered = CardMotion.of(duration.seconds, p.settings.width, p.settings.height).covered;
  if (!covered)
    throw new Error(`A ${duration.seconds.toFixed(2)} s card is too short to cover the frame.`);
  return covered;
}

/** Where `addSectionCards` puts each card, in time order. */
export function cardPlacements(
  p: Project,
  markerIDs?: readonly string[] | null,
  duration?: Time | null,
  kicker?: string | null,
  cuts?: Readonly<Record<string, Time>> | null,
): CardPlacement[] {
  let markers: Marker[];
  if (markerIDs) {
    const seen = new Set<string>();
    markers = markerIDs.flatMap((id) => {
      const marker = p.markers.find((m) => m.id === id);
      if (!marker) throw new Error(`Marker ${id} not found.`);
      if (seen.has(id)) return [];
      seen.add(id);
      return [marker];
    });
  } else markers = p.markers.filter((m) => markerKind(m) === "section" && m.time > 0);
  markers = markers.toSorted((a, b) => a.time - b.time);
  if (!markers.length)
    throw new Error(
      markerIDs
        ? "No markers given."
        : "There are no section markers after the start to put cards on. Mark where each section starts with a section marker.",
    );
  if (duration) coverage(duration, p);
  for (const id of Object.keys(cuts ?? {}))
    if (!p.markers.some((m) => m.id === id)) throw new Error(`Marker ${id} for a cut not found.`);
  const rate = p.settings.frameRate,
    frame = flicksPerFrame(rate);
  const word = kicker?.trim() ?? "";
  return markers.map((marker, offset) => {
    const number = numberText(offset + 1),
      at = Time.fromSeconds(marker.time);
    // A card already there stays where it is, as long as it is.
    const existing = existingCard(at, p);
    if (existing)
      return {
        marker,
        number,
        start: existing.start,
        duration: existing.duration,
        existingClipID: existing.id,
        cut: at,
        cutReach: new Time(0n),
      };
    const length =
      duration ??
      fittedDuration(
        cardProps({
          title: marker.name,
          subtitle: (marker.note ?? "").trim(),
          number,
          total: markers.length,
          kicker: word,
        }),
        rate,
      );
    const [lower, upper] = coverage(length, p);
    // The card covers its marker wherever the cut goes.
    const margin = Time.fromSeconds(Math.min(lower, length.seconds - upper)).flicks - frame;
    const reach = new Time(
      margin < 0n
        ? 0n
        : margin < Time.fromSeconds(MAX_CUT_SHIFT).flicks
          ? margin
          : Time.fromSeconds(MAX_CUT_SHIFT).flicks,
    );
    const cut = cuts?.[marker.id] ?? at;
    const shift = cut.flicks - at.flicks;
    if ((shift < 0n ? -shift : shift) > reach.flicks || cut.flicks < 0n)
      throw new Error(
        `The cut for "${marker.name}" at ${cut.seconds} is ${Math.abs(cut.seconds - at.seconds).toFixed(2)} s from its marker. Keep it within ${reach.seconds.toFixed(2)} s of it, in the pause before the section's first word.`,
      );
    const ideal = cut.subtract(Time.fromSeconds(lower));
    const start = Time.frames(ideal.frameIndex(rate), rate);
    return {
      marker,
      number,
      start: start.flicks < 0n ? new Time(0n) : start,
      duration: length,
      existingClipID: null,
      cut,
      cutReach: reach,
    };
  });
}

/** Fit to text: trims card `clipID` to its words and moves its sweep-out sounds. */
export function fitToText(clipID: string, p: Project): EditCommand[] {
  const clip = tracks(p)
    .flatMap((t) => t.clips)
    .find((c) => c.id === clipID);
  const props = clip && cardOf(clip);
  if (!clip || !props) throw new Error(`${clipID} isn't a section card.`);
  const fitted = fittedDuration(props, p.settings.frameRate);
  if (fitted.flicks === clip.duration.flicks) return [];
  const commands = [
    {
      trim: {
        clipID: clip.id,
        edge: "end",
        to: clip.start.add(fitted),
        ripple: false,
        includeLinked: false,
      },
    },
  ] as unknown as EditCommand[];
  if (clip.linkGroup == null) return commands;
  const { width, height } = p.settings;
  const before = CardMotion.of(clip.duration.seconds, width, height),
    after = CardMotion.of(fitted.seconds, width, height);
  const sweepIn = clip.start.add(Time.fromSeconds(before.inStart(0))),
    sweepOut = clip.start.add(Time.fromSeconds(before.outStart(0)));
  const distance = (a: Time, b: Time) =>
    a.flicks > b.flicks ? a.flicks - b.flicks : b.flicks - a.flicks;
  const outSounds = p.audioTracks
    .flatMap((t) => t.clips)
    .filter(
      (sound) =>
        sound.linkGroup === clip.linkGroup &&
        distance(sound.start, sweepOut) < distance(sound.start, sweepIn),
    );
  const delta = Time.fromSeconds(after.outStart(0)).subtract(Time.fromSeconds(before.outStart(0)));
  if (outSounds.length && delta.flicks !== 0n)
    commands.push({
      moveClips: {
        clipIDs: outSounds.map((s) => s.id),
        delta,
        includeLinked: false,
        mode: "place",
      },
    } as unknown as EditCommand);
  return commands;
}

type Apply = (p: Project, command: EditCommand) => Project;
const free = (clips: readonly Clip[], a: Time, b: Time) =>
  clips.every((c) => c.start.flicks >= b.flicks || end(c).flicks <= a.flicks);

function sfxTrack(p: Project, a: Time, b: Time, context: EditContext): { p: Project; id: string } {
  const isSFX = (name: string) => /^sfx(?: \d+)?$/i.test(name);
  const candidates = p.audioTracks.filter((t) => isSFX(t.name));
  const found = candidates.find((t) => !t.locked && free(t.clips, a, b));
  if (found) return { p, id: found.id };
  const taken = new Set(p.audioTracks.map((t) => t.name.toLowerCase()));
  let number = candidates.length + 1;
  while (taken.has(`sfx ${number}`)) number++;
  const track = Schema.decodeUnknownSync(TrackSchema)({
    id: context.makeID("trk"),
    kind: "audio",
    name: candidates.length ? `SFX ${number}` : "SFX",
    rippleMode: "follow",
  });
  context.createdIDs.push(track.id);
  return { p: { ...p, audioTracks: [...p.audioTracks, track] }, id: track.id };
}

export function editSectionCards(
  p: Project,
  command: EditCommand,
  context: EditContext,
  apply: Apply,
): Project | null {
  if ("fitSectionCards" in command) {
    const ids =
      command.fitSectionCards.clipIDs ??
      p.videoTracks.flatMap((t) => t.clips.filter((c) => cardOf(c)).map((c) => c.id));
    if (!ids.length) throw new Error("There are no section cards to fit.");
    for (const id of ids) for (const step of fitToText(id, p)) p = apply(p, step);
    return p;
  }
  if (!("addSectionCards" in command)) return null;
  const request = command.addSectionCards;
  const mode = request.mode ?? "overwrite";
  const placements = cardPlacements(
    p,
    request.markerIDs,
    request.duration,
    request.kicker,
    mode === "insert" ? request.cuts : null,
  );
  const rate = p.settings.frameRate;
  let cardTrackID: string;
  if (request.trackID != null) {
    const track = requireTrack(p, request.trackID);
    if (track.kind !== "video")
      throw new Error(`Section cards go on a video track, and "${track.name}" is an audio track.`);
    cardTrackID = track.id;
  } else {
    const graphics = p.videoTracks.find((t) => t.name.toLowerCase() === "graphics");
    if (graphics) cardTrackID = graphics.id;
    else {
      const track = Schema.decodeUnknownSync(TrackSchema)({
        id: context.makeID("trk"),
        kind: "video",
        name: "Graphics",
        rippleMode: "follow",
      });
      context.createdIDs.push(track.id);
      p = { ...p, videoTracks: [...p.videoTracks, track] };
      cardTrackID = track.id;
    }
  }
  unlocked(requireTrack(p, cardTrackID));
  for (const sound of [request.soundIn, request.soundOut]) {
    if (!sound) continue;
    const item = p.media.find((m) => m.id === sound.mediaID);
    if (!item) throw new Error(`Media ${sound.mediaID} for the section cards' sound not found.`);
    if (!item.hasAudio)
      throw new Error(`${item.path} has no sound, so it can't be a section card's sound.`);
  }
  const total = placements.length;
  const kickerWord = request.kicker?.trim();
  if (mode !== "insert")
    placements.slice(1).forEach((b, i) => {
      const a = placements[i]!;
      if (a.existingClipID == null && b.start.flicks < a.start.add(a.duration).flicks)
        context.warn(
          `The sections "${a.marker.name}" and "${b.marker.name}" are closer than a card is long, so the first card cuts into the second one's wipe in.`,
        );
    });
  // Latest first, so making room at one marker leaves earlier ones where they belong.
  for (const placement of placements.toReversed()) {
    const marker = placement.marker;
    if (placement.existingClipID) {
      const id = placement.existingClipID;
      const track = tracks(p).find((t) => t.clips.some((c) => c.id === id))!;
      unlocked(track);
      p = replace(p, {
        ...track,
        clips: track.clips.map((c) => {
          if (c.id !== id) return c;
          const props = cardOf(c) ?? cardProps();
          return {
            ...c,
            content: cardContent({
              ...props,
              number: placement.number,
              total,
              title: props.title || marker.name,
              kicker: kickerWord ?? props.kicker,
            }) as Clip["content"],
          };
        }),
      });
      continue;
    }
    const props = cardProps({
      title: marker.name,
      subtitle: (marker.note ?? "").trim(),
      number: placement.number,
      total,
      kicker: kickerWord ?? "",
    });
    const { start, duration: length } = placement;
    const [, upper] = coverage(length, p);
    const motion = CardMotion.of(length.seconds, p.settings.width, p.settings.height);
    if (mode === "insert") {
      // Room for the hold: the shot before plays under the wipe in up to the cut,
      // and the next one starts as the wipe out shows it.
      const cut = placement.cut;
      const reveal = start.add(Time.fromSeconds(upper));
      const room = Time.frames(reveal.subtract(cut).frameIndex(rate), rate);
      if (room.flicks > 0n) {
        p = removeTransitionsAt(cut, p, context);
        const edited = new Set(
          tracks(p)
            .filter((t) => t.rippleMode === "cut")
            .map((t) => t.id),
        );
        p = openTime(p, insertionPoint(p, cut, edited, context), room, edited, context, {
          keepingMarkersAt: false,
        });
      }
    }
    const group = request.soundIn || request.soundOut ? context.makeID("lnk") : null;
    const card: Clip = {
      id: context.makeID("clip"),
      content: cardContent(props) as Clip["content"],
      start,
      duration: length,
      sourceStart: new Time(0n),
      speed: 1,
      freezeFrame: false,
      enabled: true,
      keyframes: {},
      tags: [],
      ...(group ? { linkGroup: group } : {}),
    };
    let track = requireTrack(p, cardTrackID);
    if (mode === "place" && !free(track.clips, start, end(card)))
      throw new Error(
        `"${track.name}" already has a clip between ${start.seconds} and ${end(card).seconds}, where the card for "${marker.name}" goes.`,
      );
    track = clearRange(track, start, end(card), context);
    p = replace(p, sorted({ ...track, clips: [...track.clips, card] }));
    context.createdIDs.push(card.id);
    const sweeps = [
      [request.soundIn, start.add(Time.fromSeconds(motion.inStart(0))), SOUND_IN_OFFSET],
      [request.soundOut, start.add(Time.fromSeconds(motion.outStart(0))), 0],
    ] as const;
    for (const [sound, sweep, offset] of sweeps) {
      if (!sound) continue;
      const item = p.media.find((m) => m.id === sound.mediaID)!;
      const at = sweep.add(sound.offset ?? Time.fromSeconds(offset));
      const soundStart = at.flicks < 0n ? new Time(0n) : at;
      const soundLength =
        item.duration && item.duration.flicks > 0n ? item.duration : Time.fromSeconds(1);
      const placed = sfxTrack(p, soundStart, soundStart.add(soundLength), context);
      p = placed.p;
      const sfx = requireTrack(p, placed.id);
      const clip: Clip = {
        id: context.makeID("clip"),
        content: { media: { mediaID: item.id } } as Clip["content"],
        start: soundStart,
        duration: soundLength,
        sourceStart: new Time(0n),
        speed: 1,
        freezeFrame: false,
        enabled: true,
        keyframes: {},
        tags: [],
        audio: { gainDB: sound.gainDB ?? SOUND_GAIN_DB },
        ...(group ? { linkGroup: group } : {}),
      };
      p = replace(p, sorted({ ...sfx, clips: [...sfx.clips, clip] }));
      context.createdIDs.push(clip.id);
    }
  }
  return p;
}

/** Removes transitions on a cut that room made there would pull apart; the card hides the cut. */
function removeTransitionsAt(time: Time, p: Project, context: EditContext): Project {
  for (const track of tracks(p)) {
    if (track.locked) continue;
    const clips = new Map(track.clips.map((c) => [c.id, c]));
    const onCut = track.transitions.filter((t) => {
      const from = clips.get(String(t.fromClipID)),
        to = clips.get(String(t.toClipID));
      return from && to && end(from).flicks === time.flicks && to.start.flicks === time.flicks;
    });
    if (!onCut.length) continue;
    p = replace(p, { ...track, transitions: track.transitions.filter((t) => !onCut.includes(t)) });
    for (const transition of onCut)
      context.warn(
        `The ${String(transition.type)} on ${track.name} at ${time.seconds} is gone: its section card covers that cut now.`,
      );
  }
  return p;
}
