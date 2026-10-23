// Ported from TandemCore/Templates.swift and the built-in templates in
// TandemApp/Library/LibraryDrops.swift. See tests/fixtures/tandem/TANDEM-LICENSE.
import { Schema } from "effect";
import {
  ClipSchema,
  MediaItemSchema,
  TrackSchema,
  type Clip,
  type MediaItem,
  type Project,
} from "@sidecut/contracts/project";
import type { EditCommand } from "@sidecut/contracts/commands";
import { Time } from "@sidecut/contracts/time";
import { SECTION_CARD, cardProps, fittedDuration } from "./section-cards";
import {
  clearRange,
  end,
  insertionPoint,
  openTime,
  replace,
  sorted,
  tracks,
  unlocked,
  type EditContext,
} from "./timeline-editing";

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v);
export const TRANSITION_DEFAULTS: Record<string, number> = {
  dissolve: 0.5,
  fadeToBlack: 1.1,
  fadeFromBlack: 1.1,
  push: 0.7,
  slide: 0.7,
  cutSlide: 0.57,
  wipe: 0.6,
  zoom: 0.5,
};

export interface TemplateField {
  key: string;
  label: string;
  defaultValue: string;
}
export interface TemplateClip {
  track: string;
  trackKind: "video" | "audio";
  offset: Time;
  clip: Clip;
  mediaPath: string | null;
  media: MediaItem | null;
}
export interface TemplateTransition {
  from: number | null;
  to: number | null;
  type: string;
  direction: string | null;
  duration: number;
  sound: number | null;
}
export interface Template {
  id: string;
  name: string;
  duration: Time;
  fields: TemplateField[];
  clips: TemplateClip[];
  transitions: TemplateTransition[];
}

const finite = (v: unknown, what: string) => {
  if (typeof v !== "number" || !Number.isFinite(v))
    throw new Error(`Template ${what} must be a number.`);
  return v;
};
const index = (v: unknown) => (typeof v === "number" && Number.isInteger(v) ? v : null);

/** Decodes a template leniently, with the reference's defaults. */
export function decodeTemplate(value: unknown): Template {
  if (!isObject(value) || typeof value.id !== "string") throw new Error("Templates need an id.");
  if (!Array.isArray(value.clips)) throw new Error(`Template ${value.id} needs clips.`);
  return {
    id: value.id,
    name: typeof value.name === "string" ? value.name : value.id,
    duration: Time.fromSeconds(finite(value.duration, "duration")),
    fields: (Array.isArray(value.fields) ? value.fields : []).map((f) => {
      if (!isObject(f) || typeof f.key !== "string") throw new Error("Template fields need a key.");
      return {
        key: f.key,
        label: typeof f.label === "string" ? f.label : f.key,
        defaultValue: typeof f.defaultValue === "string" ? f.defaultValue : "",
      };
    }),
    clips: value.clips.map((item) => {
      if (!isObject(item) || typeof item.track !== "string")
        throw new Error("Template clips need a track name.");
      const media = isObject(item.media)
        ? Schema.decodeUnknownSync(MediaItemSchema)(item.media)
        : null;
      const mediaPath = typeof item.mediaPath === "string" ? item.mediaPath : (media?.path ?? null);
      const raw = isObject(item.clip) ? { ...item.clip } : {};
      // Media clips name their file with `mediaPath`, so they may leave content out.
      if (mediaPath != null && raw.content == null) raw.content = { media: { mediaID: "" } };
      return {
        track: item.track,
        trackKind: item.trackKind === "audio" ? "audio" : "video",
        offset: Time.fromSeconds(item.offset == null ? 0 : finite(item.offset, "offset")),
        clip: Schema.decodeUnknownSync(ClipSchema)(raw),
        mediaPath,
        media,
      } satisfies TemplateClip;
    }),
    transitions: (Array.isArray(value.transitions) ? value.transitions : []).map((t) => {
      if (!isObject(t) || typeof t.type !== "string")
        throw new Error("Template transitions need a type.");
      return {
        from: index(t.from),
        to: index(t.to),
        type: t.type,
        direction: typeof t.direction === "string" ? t.direction : null,
        duration:
          t.duration == null
            ? (TRANSITION_DEFAULTS[t.type] ?? 0.5)
            : finite(t.duration, "transition duration"),
        sound: index(t.sound),
      };
    }),
  };
}

/** Replaces `{{key}}` in text clips and string graphic props, falling back to field defaults. */
export function fillTemplate(template: Template, values: Readonly<Record<string, string>>) {
  const lookup = new Map(template.fields.map((f) => [f.key, f.defaultValue]));
  for (const [key, value] of Object.entries(values)) lookup.set(key, value);
  const fill = (text: string) =>
    [...lookup].reduce((out, [key, value]) => out.replaceAll(`{{${key}}}`, value), text);
  return template.clips.map((item) => {
    const content = item.clip.content as Json;
    if (isObject(content.text) && typeof content.text.text === "string")
      return {
        ...item,
        clip: {
          ...item.clip,
          content: { text: { ...content.text, text: fill(content.text.text) } },
        } as unknown as Clip,
      };
    if (isObject(content.graphic)) {
      const props = isObject(content.graphic.props) ? content.graphic.props : {};
      const filled = Object.fromEntries(
        Object.entries(props).map(([k, v]) => [k, typeof v === "string" ? fill(v) : v]),
      );
      return {
        ...item,
        clip: {
          ...item.clip,
          content: { graphic: { ...content.graphic, props: filled } },
        } as unknown as Clip,
      };
    }
    return item;
  });
}

type Apply = (p: Project, command: EditCommand) => Project;
const free = (clips: readonly Clip[], clip: Clip) =>
  clips.every((c) => c.start.flicks >= end(clip).flicks || end(c).flicks <= clip.start.flicks);

export function editTemplates(
  p: Project,
  command: EditCommand,
  context: EditContext,
  apply: Apply,
): Project | null {
  if (!("insertTemplate" in command)) return null;
  const { at, values, mode = "place" } = command.insertTemplate;
  const template = decodeTemplate(command.insertTemplate.template);
  if (at.flicks < 0n) throw new Error("Templates can't start before 0.");
  if (!template.clips.length) throw new Error(`Template ${template.id} has no clips.`);
  const items = fillTemplate(template, values ?? {});
  const group = items.length > 1 ? context.makeID("lnk") : null;
  const planned: { trackID: string; clip: Clip }[] = [];
  for (const item of items) {
    const key = item.trackKind === "video" ? "videoTracks" : "audioTracks";
    let track = p[key].find((t) => t.name.toLowerCase() === item.track.toLowerCase());
    if (!track) {
      track = Schema.decodeUnknownSync(TrackSchema)({
        id: context.makeID("trk"),
        kind: item.trackKind,
        name: item.track,
      });
      context.createdIDs.push(track.id);
      p = { ...p, [key]: [...p[key], track] };
    }
    const { linkGroup: _linkGroup, ...rest } = item.clip;
    let clip = {
      ...rest,
      ...(group ? { linkGroup: group } : {}),
      id: context.makeID("clip"),
      start: at.add(item.offset),
      tags: item.clip.tags.includes(`template:${template.id}`)
        ? item.clip.tags
        : [...item.clip.tags, `template:${template.id}`],
    } as Clip;
    if (item.mediaPath != null) {
      let media = p.media.find((m) => m.path === item.mediaPath);
      if (!media) {
        if (!item.media)
          throw new Error(
            `Media ${item.mediaPath} for template ${template.id} not found; add it to the project first.`,
          );
        const ids = new Set([
          p.id,
          ...p.media.map((m) => m.id),
          ...p.markers.map((m) => m.id),
          ...tracks(p).flatMap((t) => [
            t.id,
            ...t.clips.map((c) => c.id),
            ...t.transitions.map((x) => x.id),
          ]),
        ]);
        media = {
          ...item.media,
          path: item.mediaPath,
          id: !item.media.id || ids.has(item.media.id) ? context.makeID("med") : item.media.id,
        };
        p = { ...p, media: [...p.media, media] };
      }
      clip = { ...clip, content: { media: { mediaID: media.id } } as Clip["content"] };
    }
    unlocked(track);
    planned.push({ trackID: track.id, clip });
  }
  const find = (id: string) => tracks(p).find((t) => t.id === id)!;
  if (mode === "place") {
    for (const { trackID, clip } of planned)
      if (!free(find(trackID).clips, clip))
        throw new Error(
          `"${find(trackID).name}" already has a clip between ${clip.start.seconds} and ${end(clip).seconds}.`,
        );
  } else if (mode === "overwrite") {
    for (const { trackID, clip } of planned)
      p = replace(p, clearRange(find(trackID), clip.start, end(clip), context));
  } else {
    const edited = new Set(planned.map((x) => x.trackID));
    const point = insertionPoint(p, at, edited, context);
    for (const entry of planned)
      entry.clip = { ...entry.clip, start: entry.clip.start.add(point.subtract(at)) };
    p = openTime(p, point, template.duration, edited, context, { keepingMarkersAt: true });
  }
  for (const { trackID, clip } of planned) {
    const track = find(trackID);
    p = replace(p, sorted({ ...track, clips: [...track.clips, clip] }));
    context.createdIDs.push(clip.id);
  }
  for (const item of template.transitions) {
    const entryAt = (i: number | null) => {
      if (i == null) return null;
      const entry = planned[i];
      if (!entry)
        throw new Error(
          `Template ${template.id} has a transition on clip ${i}, which it doesn't have.`,
        );
      return entry;
    };
    const from = entryAt(item.from),
      to = entryAt(item.to);
    const location = (from ?? to)?.trackID;
    if (!location) throw new Error(`Template ${template.id} has a transition with no clip.`);
    if (from && to && from.trackID !== to.trackID)
      throw new Error(
        `Template ${template.id} has a transition between clips on different tracks.`,
      );
    const sound = entryAt(item.sound);
    if (sound && find(sound.trackID).kind !== "audio")
      throw new Error(
        `Template ${template.id} gives a transition a sound that isn't on an audio track.`,
      );
    p = apply(p, {
      addTransition: {
        trackID: location,
        transition: {
          id: context.makeID("tr"),
          type: item.type,
          duration: item.duration,
          ...(item.direction ? { direction: item.direction } : {}),
          ...(from ? { fromClipID: from.clip.id } : {}),
          ...(to ? { toClipID: to.clip.id } : {}),
          ...(sound ? { soundClipID: sound.clip.id } : {}),
        },
      },
    } as unknown as EditCommand);
  }
  return p;
}

// MARK: Built-in templates

const sectionFields: TemplateField[] = [
  { key: "number", label: "Number", defaultValue: "01" },
  { key: "title", label: "Title", defaultValue: "The leaderboard" },
  { key: "subtitle", label: "Subtitle", defaultValue: "Who's on top" },
];
const lowThird = { transform: { position: { x: 0.5, y: 0.84 }, scale: 0.7 } };
const callout = (id: string, name: string) => ({
  id,
  name,
  duration: 2.5,
  fields: [],
  clips: [
    {
      track: "Text",
      trackKind: "video",
      offset: 0,
      clip: {
        name,
        content: { text: { text: name, preset: "callout" } },
        start: 0,
        duration: 2.5,
        video: lowThird,
      },
    },
  ],
});
const sectionLength = fittedDuration(
  cardProps({ title: "The leaderboard", subtitle: "Who's on top", number: "01" }),
).toJSON();

/** The reference's built-in templates as their JSON, ready for `insertTemplate`. */
export const BUILT_IN_TEMPLATES = [
  {
    id: "sectionCard",
    name: "Section card",
    duration: sectionLength,
    fields: sectionFields,
    clips: [
      {
        track: "Graphics",
        trackKind: "video",
        offset: 0,
        clip: {
          id: "clip_sectioncard",
          content: {
            graphic: {
              template: SECTION_CARD,
              props: { number: "{{number}}", title: "{{title}}", subtitle: "{{subtitle}}" },
            },
          },
          start: 0,
          duration: sectionLength,
        },
      },
    ],
  },
  callout("likeAndSubscribe", "Like and subscribe"),
  callout("commentBelow", "Comment below"),
] as const;
