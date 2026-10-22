// Ported from Editing.swift, StickerAnchor.swift and SyncedPlacement.swift at 735a9b8.
// Upstream notice: tests/fixtures/tandem/TANDEM-LICENSE.
import { Schema } from "effect";
import { ClipSchema, TrackSchema } from "@sidecut/contracts/project";
import type { Clip, Project, Track, MediaItem } from "@sidecut/contracts/project";
import type { EditCommand } from "@sidecut/contracts/commands";
import { Time, flicksPerFrame } from "@sidecut/contracts/time";
import type { EditContext } from "./timeline-editing";
import {
  tracks,
  end,
  requireTrack,
  unlocked,
  guardSounds,
  replace,
  sorted,
  clearRange,
  insertionPoint,
  openTime,
  editTimeline,
  linkedIDs,
  split,
} from "./timeline-editing";

const zero = new Time(0n);
const mediaID = (clip: Clip) => {
  const value = clip.content.media;
  return value && typeof value === "object" && "mediaID" in value ? value.mediaID : null;
};
function addTrack(
  p: Project,
  kind: "video" | "audio",
  name: string | undefined,
  context: EditContext,
  index?: number,
): { project: Project; track: Track } {
  const list = kind === "video" ? p.videoTracks : p.audioTracks;
  const track = Schema.decodeUnknownSync(TrackSchema)({
    id: context.makeID("trk"),
    kind,
    name: name ?? `${kind === "video" ? "Video" : "Audio"} ${list.length + 1}`,
  });
  context.createdIDs.push(track.id);
  const ordered = [...list];
  ordered.splice(index ?? ordered.length, 0, track);
  return { project: { ...p, [kind === "video" ? "videoTracks" : "audioTracks"]: ordered }, track };
}
function trackName(role: MediaItem["role"], kind: "video" | "audio") {
  if (kind === "video")
    return (
      {
        camera: "Camera",
        screen: "Screen",
        broll: "B-roll",
        image: "B-roll",
        graphic: "Graphics",
        sticker: "Graphics",
      } as Partial<Record<MediaItem["role"], string>>
    )[role];
  return (
    {
      camera: "Voice",
      screen: "Voice",
      other: "Voice",
      music: "Music",
      sfx: "SFX",
      broll: "SFX",
      sticker: "SFX",
      graphic: "SFX",
    } as Partial<Record<MediaItem["role"], string>>
  )[role];
}
const free = (track: Track, start: Time, duration: Time) =>
  !track.clips.some(
    (c) => c.start.flicks < start.flicks + duration.flicks && end(c).flicks > start.flicks,
  );
function route(
  p: Project,
  role: MediaItem["role"],
  kind: "video" | "audio",
  at: Time,
  duration: Time,
  mode: string,
  context: EditContext,
) {
  const list = kind === "video" ? p.videoTracks : p.audioTracks,
    name = trackName(role, kind);
  if (name === "SFX" && mode === "place") {
    const found = list.find(
      (t) => /^SFX(?: \d+)?$/i.test(t.name) && !t.locked && free(t, at, duration),
    );
    if (found) return { project: p, track: found };
    let number = 1;
    while (list.some((t) => t.name.toLowerCase() === (number === 1 ? "sfx" : `sfx ${number}`)))
      number++;
    return addTrack(p, kind, number === 1 ? "SFX" : `SFX ${number}`, context);
  }
  const found =
    list.find((t) => name && t.name.toLowerCase() === name.toLowerCase() && !t.locked) ??
    list.find((t) => !t.locked && (mode !== "place" || free(t, at, duration)));
  return found ? { project: p, track: found } : addTrack(p, kind, name, context);
}
function placedAudio(item: MediaItem, track: Track, p: Project) {
  if (track.rippleMode === "cut" || ["camera", "other"].includes(item.role))
    return { normalizeTo: p.settings.speechLoudness };
  if (item.role === "music") return { gainDB: -31, fadeOut: 2 };
  if (item.role === "sfx") return { gainDB: -15 };
  return undefined;
}
function picture(
  clip: Clip,
  item: MediaItem,
  p: Project,
  anchor: string | null | undefined,
  pop: boolean,
): Clip {
  let scale = 1;
  if (anchor) {
    const w = p.settings.width,
      h = p.settings.height,
      sw = item.width ?? w,
      sh = item.height ?? h,
      fit = Math.min(w / sw, h / sh);
    scale = Math.min((0.4 * w) / (sw * fit), (0.3 * h) / (sh * fit), 2 / fit);
    const width = (sw * fit * scale) / w,
      height = (sh * fit * scale) / h,
      marginX = (0.05 * h) / w;
    const x =
      anchor === "lowerThird"
        ? 0.1 + width / 2
        : anchor.endsWith("Left")
          ? marginX + width / 2
          : anchor.endsWith("Right")
            ? 1 - marginX - width / 2
            : 0.5;
    const y =
      anchor === "lowerThird"
        ? 0.9 - height / 2
        : anchor.startsWith("top")
          ? 0.05 + height / 2
          : anchor.startsWith("bottom")
            ? 0.95 - height / 2
            : 0.5;
    clip = { ...clip, video: { transform: { position: { x, y }, scale, rotation: 0 } } };
  }
  const length = clip.duration.seconds;
  if (pop && length >= 0.8)
    clip = {
      ...clip,
      keyframes: {
        "video.transform.scale": [
          [0, scale * 0.01, "easeOut"],
          [0.15, scale * 1.1, "easeInOut"],
          [0.25, scale, "linear"],
          [length - 0.3, scale, "linear"],
          [length - 0.2, scale * 1.1, "easeIn"],
          [length - 0.05, scale * 0.01, "linear"],
        ].map(([time, value, interpolation]) => ({
          time: Time.fromSeconds(Number(time)).toJSON(),
          value: Number(value),
          interpolation: String(interpolation),
        })),
      },
    };
  return clip;
}
function place(
  p: Project,
  body: Extract<EditCommand, { placeMedia: unknown }>["placeMedia"],
  context: EditContext,
): Project {
  if (!body.mediaIDs.length) throw new Error("Place media needs at least one media ID.");
  if (body.at.flicks < 0n) throw new Error("Clips cannot start before zero.");
  const speed = body.speed ?? 1,
    mode = body.mode ?? "place";
  if (!(speed > 0 && speed <= 100)) throw new Error("Speed must be above 0 and at most 100.");
  const items = body.mediaIDs.map((id) => {
    const item = p.media.find((m) => m.id === id);
    if (!item) throw new Error(`Media ${id} not found.`);
    return item;
  });
  const isTake =
    items.length > 1 &&
    items.every((item) => item.takeID != null && item.takeID === items[0]!.takeID);
  const offsets = items.map((item) => (isTake ? (item.takeOffset ?? zero) : zero));
  const takeStart = body.sourceStart ?? offsets.reduce((a, b) => (a.flicks > b.flicks ? a : b));
  const starts = offsets.map((offset) => takeStart.subtract(offset));
  if (starts.some((start) => start.flicks < 0n))
    throw new Error("A file starts later in the take than the requested source start.");
  const available = items
    .flatMap((item, i) =>
      item.kind !== "image" && item.duration
        ? [{ item, length: item.duration.subtract(starts[i]!) }]
        : [],
    )
    .sort((a, b) =>
      a.length.flicks < b.length.flicks ? -1 : a.length.flicks > b.length.flicks ? 1 : 0,
    );
  const duration = body.duration ?? available[0]?.length.scaled(1 / speed) ?? Time.fromSeconds(5);
  if (duration.flicks <= 0n) throw new Error("Nothing left to place after the source start.");
  const planned: { trackID: string; clip: Clip }[] = [];
  for (const [index, item] of items.entries()) {
    const kinds: ("video" | "audio")[] = [];
    if (item.hasVideo || item.kind === "image") kinds.push("video");
    if (
      item.hasAudio &&
      (body.includeAudio ?? ["camera", "music", "sfx", "other"].includes(item.role))
    )
      kinds.push("audio");
    for (const kind of kinds) {
      const explicit = kind === "video" ? body.videoTrackID : body.audioTrackID;
      let track: Track;
      if (explicit && items.length === 1) {
        track = requireTrack(p, explicit);
        if (track.kind !== kind) throw new Error(`A ${kind} source needs a ${kind} track.`);
      } else {
        const routed = route(p, item.role, kind, body.at, duration, mode, context);
        p = routed.project;
        track = routed.track;
      }
      unlocked(track);
      guardSounds(track);
      let clip = Schema.decodeUnknownSync(ClipSchema)({
        id: context.makeID("clip"),
        name: item.path
          .split(/[\\/]/)
          .at(-1)
          ?.replace(/\.[^.]+$/, ""),
        content: { media: { mediaID: item.id } },
        start: body.at.toJSON(),
        duration: duration.toJSON(),
        sourceStart: item.kind === "image" ? 0 : starts[index]!.toJSON(),
        speed: item.kind === "image" ? 1 : speed,
        ...(kind === "audio" ? { audio: placedAudio(item, track, p) ?? null } : {}),
      });
      if (kind === "video")
        clip = picture(
          clip,
          item,
          p,
          body.anchor ?? (item.role === "sticker" ? "bottom" : null),
          body.pop ?? false,
        );
      planned.push({ trackID: track.id, clip });
    }
  }
  if (!planned.length) throw new Error("None of those files has picture or sound to place.");
  if (new Set(planned.map((entry) => entry.trackID)).size !== planned.length)
    throw new Error(
      "These files would overlap each other on one destination track. Place them separately or choose separate role tracks.",
    );
  const group = planned.length > 1 ? context.makeID("lnk") : null;
  if (mode === "insert") {
    const edited = new Set(planned.map((entry) => entry.trackID)),
      at = insertionPoint(p, body.at, edited, context);
    p = openTime(p, at, duration, edited, context, { keepingMarkersAt: true });
    for (const entry of planned) entry.clip = { ...entry.clip, start: at };
  }
  for (const entry of planned) {
    let track = requireTrack(p, entry.trackID);
    if (mode === "overwrite") track = clearRange(track, entry.clip.start, end(entry.clip), context);
    else if (!free(track, entry.clip.start, entry.clip.duration))
      throw new Error(`Track "${track.name}" already has a clip in this range.`);
    p = replace(
      p,
      sorted({ ...track, clips: [...track.clips, { ...entry.clip, linkGroup: group }] }),
    );
    context.createdIDs.push(entry.clip.id);
  }
  if (
    body.duration == null &&
    available.length > 1 &&
    available.at(-1)!.length.subtract(available[0]!.length).flicks >
      flicksPerFrame(p.settings.frameRate) / 2n
  )
    context.warn(
      `Placed ${duration.seconds} seconds of the take, as far as ${available[0]!.item.path} goes; ${available.at(-1)!.item.path} runs longer.`,
    );
  return p;
}
function synced(
  p: Project,
  body: Extract<EditCommand, { placeSynced: unknown }>["placeSynced"],
  context: EditContext,
): Project {
  const item = p.media.find((m) => m.id === body.mediaID);
  if (!item) throw new Error(`Media ${body.mediaID} not found.`);
  if (!item.takeID)
    throw new Error("This file needs a take ID and source offset before synced placement.");
  if (
    item.kind === "image" ||
    !(item.hasVideo || item.hasAudio) ||
    !item.duration ||
    item.duration.flicks <= 0n
  )
    throw new Error("This file has no picture or sound to place.");
  if (tracks(p).some((t) => t.clips.some((c) => mediaID(c) === item.id)))
    throw new Error(
      "This file is already on the timeline; remove its clips before placing it again.",
    );
  const partners = new Map(
    p.media.filter((m) => m.takeID === item.takeID && m.id !== item.id).map((m) => [m.id, m]),
  );
  const find = (list: readonly Track[], camera: boolean) =>
    list
      .map((track) => ({
        track,
        clips: track.clips.filter((c) => {
          const m = partners.get(String(mediaID(c)));
          return m && (!camera || m.role === "camera");
        }),
      }))
      .find((entry) => entry.clips.length);
  const reference =
    find(p.videoTracks, true) ?? find(p.videoTracks, false) ?? find(p.audioTracks, false);
  if (!reference)
    throw new Error("Place the camera take first; nothing from this take is on the timeline.");
  unlocked(reference.track);
  const frame = flicksPerFrame(p.settings.frameRate),
    spans: { id: string; start: Time; stop: Time; delta: Time }[] = [];
  for (const clip of reference.clips) {
    if (clip.speed !== 1 || clip.freezeFrame) {
      context.warn(
        `Left ${clip.name ?? clip.id} alone: synced files only align with clips playing at normal speed.`,
      );
      continue;
    }
    const source = partners.get(String(mediaID(clip)))!;
    const delta = clip.sourceStart
      .subtract(clip.start)
      .add(source.takeOffset ?? zero)
      .subtract(item.takeOffset ?? zero);
    let start = new Time(-delta.flicks > clip.start.flicks ? -delta.flicks : clip.start.flicks),
      stop = new Time(
        item.duration.flicks - delta.flicks < end(clip).flicks
          ? item.duration.flicks - delta.flicks
          : end(clip).flicks,
      );
    if (start.flicks > clip.start.flicks)
      start = new Time(((start.flicks + frame - 1n) / frame) * frame);
    if (stop.flicks < end(clip).flicks) stop = new Time((stop.flicks / frame) * frame);
    const partial = start.flicks > clip.start.flicks || stop.flicks < end(clip).flicks;
    if (stop.flicks - start.flicks < frame || (partial && stop.subtract(start).seconds < 0.5))
      continue;
    spans.push({ id: clip.id, start, stop, delta });
  }
  if (!spans.length) throw new Error("This file does not overlap the take's clips.");
  let targetID: string | null = null,
    cameraSoundID: string | null = null;
  for (const span of spans) {
    for (const edge of [span.stop, span.start]) {
      const clip = requireTrack(p, reference.track.id).clips.find(
        (c) =>
          c.id === span.id ||
          (c.start.flicks <= span.start.flicks && end(c).flicks >= span.stop.flicks),
      );
      if (!clip) throw new Error("Could not isolate the synced range.");
      if (!(clip.start.flicks < edge.flicks && edge.flicks < end(clip).flicks)) continue;
      // Unlike ordinary blade, this must reject a locked linked member rather than leave an uncut take.
      for (const id of linkedIDs(p, [clip.id])) {
        const t = tracks(p).find((track) => track.clips.some((c) => c.id === id))!;
        unlocked(t);
        guardSounds(t);
      }
      p = editTimeline(p, { blade: { at: edge, clipIDs: [clip.id] } }, context)!;
    }
    let piece = requireTrack(p, reference.track.id).clips.find(
      (c) => c.start.flicks === span.start.flicks && end(c).flicks === span.stop.flicks,
    );
    if (!piece) throw new Error("Could not cut the take at the synced range edges.");
    const group = piece.linkGroup ?? context.makeID("lnk");
    if (!piece.linkGroup) {
      piece = { ...piece, linkGroup: group };
      const track = requireTrack(p, reference.track.id);
      p = replace(p, {
        ...track,
        clips: track.clips.map((c) => (c.id === piece!.id ? piece! : c)),
      });
    }
    if (!targetID) {
      if (body.trackID) targetID = requireTrack(p, body.trackID).id;
      else if (item.hasVideo) {
        let number = 2;
        while (p.videoTracks.some((t) => t.name.toLowerCase() === `angle ${number}`)) number++;
        const added = addTrack(
          p,
          "video",
          `Angle ${number}`,
          context,
          reference.track.kind === "video"
            ? p.videoTracks.findIndex((t) => t.id === reference.track.id) + 1
            : undefined,
        );
        p = added.project;
        targetID = added.track.id;
      } else {
        const track =
          p.audioTracks.find((t) => t.name.toLowerCase() === "voice") ??
          p.audioTracks.find((t) => t.rippleMode === "cut");
        if (!track) throw new Error("There is no Voice track; choose an audio track.");
        targetID = track.id;
      }
    }
    let target = requireTrack(p, targetID);
    if (target.kind !== (item.hasVideo ? "video" : "audio"))
      throw new Error("The synced file needs a compatible destination track.");
    unlocked(target);
    guardSounds(target);
    if (!item.hasVideo) {
      const inside = target.clips.filter(
        (c) => c.start.flicks < span.stop.flicks && end(c).flicks > span.start.flicks,
      );
      if (inside.some((c) => c.linkGroup !== group))
        throw new Error("The destination contains audio that is not the take's own sound.");
      if (inside.length) {
        for (const edge of [span.start, span.stop]) {
          const crossing = target.clips.find(
            (c) => c.start.flicks < edge.flicks && end(c).flicks > edge.flicks,
          );
          if (crossing) {
            const pair = split(crossing, edge, context);
            target = {
              ...target,
              clips: target.clips.flatMap((c) =>
                c.id === crossing.id ? [pair.left, pair.right] : [c],
              ),
            };
          }
        }
        const moving = target.clips.filter(
            (c) => c.start.flicks >= span.start.flicks && end(c).flicks <= span.stop.flicks,
          ),
          ids = new Set(moving.map((c) => c.id));
        p = replace(p, {
          ...target,
          clips: target.clips.filter((c) => !ids.has(c.id)),
          transitions: target.transitions.filter(
            (t) => !ids.has(String(t.fromClipID)) && !ids.has(String(t.toClipID)),
          ),
        });
        if (!cameraSoundID) {
          const existing = p.audioTracks.find((t) => t.name.toLowerCase() === "camera sound");
          if (existing) cameraSoundID = existing.id;
          else {
            const added = addTrack(
              p,
              "audio",
              "Camera sound",
              context,
              p.audioTracks.findIndex((t) => t.id === targetID) + 1,
            );
            p = replace(added.project, { ...added.track, muted: true });
            cameraSoundID = added.track.id;
          }
        }
        let destination = requireTrack(p, cameraSoundID);
        unlocked(destination);
        for (const clip of moving) {
          if (!free(destination, clip.start, clip.duration))
            throw new Error("Camera sound track is occupied.");
          destination = sorted({
            ...destination,
            clips: [...destination.clips, { ...clip, linkGroup: group }],
          });
        }
        p = replace(p, destination);
      }
    }
    target = requireTrack(p, targetID);
    const duration = span.stop.subtract(span.start);
    if (!free(target, span.start, duration)) throw new Error("The synced destination is occupied.");
    const video = piece.video
      ? {
          ...(piece.video.transform != null ? { transform: piece.video.transform } : {}),
          ...(piece.video.opacity != null ? { opacity: piece.video.opacity } : {}),
          ...(piece.video.layoutPreset != null ? { layoutPreset: piece.video.layoutPreset } : {}),
          ...(piece.video.formatOverrides
            ? {
                formatOverrides: Object.fromEntries(
                  Object.entries(
                    piece.video.formatOverrides as Record<string, Record<string, unknown>>,
                  ).map(([key, value]) => [
                    key,
                    {
                      ...(value.transform != null ? { transform: value.transform } : {}),
                      ...(value.hidden != null ? { hidden: value.hidden } : {}),
                    },
                  ]),
                ),
              }
            : {}),
        }
      : undefined;
    const clip = Schema.decodeUnknownSync(ClipSchema)({
      id: context.makeID("clip"),
      name: item.path
        .split(/[\\/]/)
        .at(-1)
        ?.replace(/\.[^.]+$/, ""),
      content: { media: { mediaID: item.id } },
      start: span.start.toJSON(),
      duration: duration.toJSON(),
      sourceStart: span.start.add(span.delta).toJSON(),
      linkGroup: group,
      enabled: !item.hasVideo,
      ...(item.hasVideo
        ? { video: video ?? null }
        : { audio: placedAudio(item, target, p) ?? null }),
    });
    p = replace(p, sorted({ ...target, clips: [...target.clips, clip] }));
    context.createdIDs.push(clip.id);
  }
  return p;
}
export function editPlacement(
  p: Project,
  command: EditCommand,
  context: EditContext,
): Project | null {
  if ("placeMedia" in command) return place(p, command.placeMedia, context);
  if ("placeSynced" in command) return synced(p, command.placeSynced, context);
  return null;
}
