// Ported from TandemImport/Filmora at 735a9b8. See tests/fixtures/tandem/TANDEM-LICENSE.
import { strFromU8 } from "fflate";
import { readZip, safeArchivePath } from "./archive";
import { builder, object, list, number, text, type ObjectValue } from "./import-builder";
import { takeName } from "./take-pairing";
import {
  filmoraVideo,
  filmoraAudio,
  type FilmoraProperties,
  type FilmoraMappedEffect,
} from "./filmora-properties";
import type { Clip } from "@sidecut/contracts/project";
import { mediaRole } from "./media-role";
import { Time } from "@sidecut/contracts/time";
import { filmoraTransitions, type FilmoraEdge } from "./filmora-transitions";

import { filmoraString, filmoraTicks, linkedVideo } from "./filmora-values";
import { expandFilmoraTimeline, filmoraTitle } from "./filmora-templates";
function sourcePath(filename: string) {
  let path = filename;
  if (path.startsWith("file:")) {
    path = decodeURIComponent(path.slice(5)).replace(/^\/\/localhost\//, "/");
    while (path.startsWith("//")) path = path.slice(1);
    path = path.replace(/^\/([A-Za-z]:)/, "$1");
  }
  if (path.includes("\0")) throw new Error("Invalid source path.");
  return path;
}
function roleHint(c: ObjectValue, resource: ObjectValue | undefined, path: string) {
  if ([14, 15].includes(Number(c.type))) return "screen";
  const metadata = filmoraString(c, 12);
  const kind = metadata ? object(JSON.parse(metadata)).res_type : null;
  if (kind === 46) return "music";
  if (kind === 47) return "sfx";
  if (kind === 7) return "sticker";
  if (kind === 55) return "broll";
  if (c.humanseg_hair && object(c.humanseg_hair).status === 1) return "camera";
  const lower = path.replaceAll("\\", "/").toLowerCase();
  if (lower.includes("/filmora/resnewaudio/")) return "music";
  if (lower.includes("/filmora/resaudiosound/")) return "sfx";
  if (lower.includes("/filmora/element/")) return "sticker";
  const seconds = filmoraTicks(resource?.mediaLength ?? 0);
  if (lower.includes("/filmora/audio/")) return seconds >= 30 ? "music" : "sfx";
  if (resource?.streamType === 3 && seconds > 0 && seconds < 30 && !/music|voice/.test(lower))
    return "sfx";
  return [5, 7].includes(Number(resource?.streamType))
    ? "image"
    : mediaRole(path, seconds || undefined);
}

type PlannedClip = {
  id: string;
  name: string;
  content: ObjectValue;
  start: number;
  duration: number;
  sourceStart: number;
  speed: number;
  freezeFrame?: boolean;
  role: string;
  mapID: string | null;
  take: string | null;
  linkGroup?: string;
  video?: FilmoraProperties;
  audio?: FilmoraProperties;
  keyframes?: Clip["keyframes"];
  colour: FilmoraMappedEffect[];
  tags?: string[];
  head?: FilmoraEdge;
  tail?: FilmoraEdge;
};

/** Folder entries are relative to the selected folder; media remains offline until relinked. */
export function importFilmora(
  input: Uint8Array | Readonly<Record<string, Uint8Array>>,
  options: { keepLevels?: boolean } = {},
) {
  const entries = input instanceof Uint8Array ? readZip(input) : input;
  let total = 0;
  const paths = Object.keys(entries);
  if (paths.length > 10000) throw new Error("Filmora folder exceeds 10000 entries.");
  for (const path of paths) {
    safeArchivePath(path);
    total += entries[path]!.byteLength;
  }
  if (total > 256 * 1024 * 1024) throw new Error("Filmora project exceeds the 256 MiB limit.");
  const infos = paths.filter((p) => p === "project_info.json" || p.endsWith("/project_info.json"));
  if (infos.length !== 1) throw new Error("Select one Filmora folder with project_info.json.");
  const prefix = infos[0]!.slice(0, -"project_info.json".length);
  const read = (path: string) => {
    const bytes = entries[safeArchivePath(prefix + path)];
    if (!bytes) throw new Error(`Filmora project is missing ${path}.`);
    return object(JSON.parse(strFromU8(bytes)));
  };
  const info = read("project_info.json");
  const mediaID = safeArchivePath(text(info.timeline_mediaId));
  const doc = read(`Medias/${mediaID}/timeline.wesproj`);
  const timelines = list(doc.timelineInfos).map(object);
  const timeline = timelines.find((t) => t.timelineId === doc.currentTimelineId) ?? timelines[0];
  if (!timeline) throw new Error("Filmora project has no timeline.");
  const size = list(info.project_timeline_resolution ?? [1920, 1080]);
  const rate = list(info.project_timeline_framerate ?? [30, 1]);
  const b = builder(
    typeof info.project_file_name === "string" ? info.project_file_name : "Filmora import",
    {
      width: number(size[0]),
      height: number(size[1]),
      frameRate: { numerator: number(rate[0]), denominator: number(rate[1]) },
    },
  );
  const resources = new Map(
    list(doc.resources ?? []).map((v) => {
      const r = object(v);
      return [r.sourceUuid, r];
    }),
  );
  const media = new Map<string, ObjectValue>();
  const planned = expandFilmoraTimeline(
    timeline,
    timelines,
    number(rate[1]) / number(rate[0]),
    b.warnings,
  ).map(({ node, inputs }, index) => ({
    node,
    inputs,
    index,
    kind: node.trackType === 1 ? "video" : "audio",
    linked: linkedVideo(node),
    lanes: [] as PlannedClip[][],
    names: [] as string[],
  }));
  const place = (track: (typeof planned)[number], clip: PlannedClip) => {
    let lane = track.lanes.find((l) => {
      const last = l.at(-1)!;
      return clip.start - last.start - last.duration >= -0.001;
    });
    if (lane) {
      const last = lane.at(-1)!;
      if (Math.abs(clip.start - last.start - last.duration) <= 0.001 && clip.start > last.start) {
        last.duration = clip.start - last.start;
        if (last.audio) {
          last.audio.fadeIn = Math.min(Number(last.audio.fadeIn ?? 0), last.duration);
          last.audio.fadeOut = Math.min(Number(last.audio.fadeOut ?? 0), last.duration);
        }
      }
    } else {
      if (track.lanes.length)
        b.warnings.push("Overlapping clips on one Filmora track were spread over extra tracks.");
      lane = [];
      track.lanes.push(lane);
    }
    lane.push(clip);
  };
  let sequence = 0;
  for (const track of planned) {
    for (const placement of [...track.inputs].sort(
      (a, c) => a.begin + a.shift - c.begin - c.shift,
    )) {
      const c = placement.node;
      const start = filmoraTicks(placement.begin + placement.shift),
        end = filmoraTicks(placement.end + placement.shift);
      if (Number(c.type) === 4) {
        if (track.kind !== "video") {
          b.warnings.push("A title on an audio track was left out.");
          continue;
        }
        const title = filmoraTitle(placement, b.warnings);
        if (title)
          place(track, {
            ...title,
            id: `clip_wfp_${sequence++}`,
            start,
            duration: end - start,
            sourceStart: 0,
            speed: 1,
            role: "text",
            mapID: null,
            take: null,
            colour: [],
            ...(placement.head ? { head: placement.head } : {}),
            ...(placement.tail ? { tail: placement.tail } : {}),
            ...(placement.template
              ? {
                  tags: [
                    placement.template === "filmora-template-sound"
                      ? placement.template
                      : `filmora-template:${placement.template}`,
                  ],
                }
              : {}),
          });
        continue;
      }
      if (![1, 2, 14, 15].includes(Number(c.type))) {
        b.warnings.push(
          `Unsupported Filmora clip type ${String(c.type)} on track ${track.index + 1}.`,
        );
        continue;
      }
      const resource = resources.get(c.sourceUuid);
      const filename = resource?.filename ?? c.filename;
      if (typeof filename !== "string" || !filename) {
        b.warnings.push("Missing source filename; clip omitted.");
        continue;
      }
      const path = sourcePath(filename);
      const image = [5, 7].includes(Number(resource?.streamType));
      const role = roleHint(c, resource, path);
      const speedNode = c.speed && typeof c.speed === "object" ? object(c.speed) : null;
      const parameter =
        speedNode?.speedParam == null
          ? null
          : object(
              typeof speedNode.speedParam === "string"
                ? JSON.parse(speedNode.speedParam)
                : speedNode.speedParam,
            );
      const values =
        parameter?.keyframeSets == null
          ? []
          : list(parameter.keyframeSets).map((v) => number(object(v)["_value"]));
      if (values.length > 1 && Math.abs(values.at(-1)! - 1) < 0.001) values.pop();
      let sourceStart = image ? 0 : number(speedNode?.offset, filmoraTicks(c.inPoint ?? 0));
      const hasFreeze = parameter?.["_freeze"] != null && list(parameter["_freeze"]).length > 0;
      const freezeFrame =
        !image &&
        hasFreeze &&
        number(speedNode?.offsetEnd, sourceStart) - sourceStart < number(rate[1]) / number(rate[0]);
      if (hasFreeze && !freezeFrame)
        b.warnings.push("A freeze frame inside a clip plays as normal motion.");
      if (speedNode?.reverse)
        b.warnings.push("Reversed clips play forwards; reverse playback is unsupported.");
      const ramp = new Set(values.map((v) => Math.round(v * 1000))).size > 1;
      const speed =
        image || freezeFrame
          ? 1
          : speedNode
            ? ramp
              ? (number(speedNode.offsetEnd) - sourceStart) /
                filmoraTicks(number(c.tlEnd) + 1 - number(c.tlBegin))
              : (values[0] ?? 1)
            : number(c.speed, 1);
      const trimmedSource = filmoraTicks(placement.begin - number(c.tlBegin)) * speed;
      if (!image && !freezeFrame) sourceStart += trimmedSource;
      if (ramp)
        b.warnings.push(
          `Filmora speed ramp approximated with average speed on ${String(c.thisUId ?? sequence)}.`,
        );
      if (start < 0 || end <= start || sourceStart < 0 || !Number.isFinite(speed) || speed <= 0)
        throw new Error("Invalid Filmora clip range or speed.");
      const hasVideo =
        image ||
        number(resource?.videoStreamCount, list(resource?.vidStreamInfo ?? []).length) > 0 ||
        track.kind === "video";
      const hasAudio =
        resource?.streamType === 3 ||
        number(resource?.audioStreamCount, list(resource?.audStreamInfo ?? []).length) > 0 ||
        track.kind === "audio";
      let item = media.get(path);
      if (!item) {
        item = {
          id: `med_wfp_${media.size}`,
          path,
          kind: image ? "image" : hasVideo ? "video" : "audio",
          role,
          hasVideo,
          hasAudio,
          ...(!image
            ? {
                duration: Math.max(
                  filmoraTicks(resource?.mediaLength ?? 0),
                  sourceStart + (end - start) * speed,
                ),
              }
            : {}),
        };
        const stream = list(resource?.vidStreamInfo ?? [])[0];
        if (stream) {
          const video = object(stream);
          if (video.width != null) item.width = number(video.width);
          if (video.height != null) item.height = number(video.height);
        }
        media.set(path, item);
        b.warnings.push(`Source requires relinking: ${path}`);
      } else {
        item.hasVideo ||= hasVideo;
        item.hasAudio ||= hasAudio;
        if (item.hasVideo && !image) item.kind = "video";
        if (!image)
          item.duration = Math.max(number(item.duration), sourceStart + (end - start) * speed);
      }
      const take = takeName(path);
      const clip: PlannedClip = {
        id: `clip_wfp_${sequence++}`,
        name: filmoraString(c, 50) ?? path.replaceAll("\\", "/").split("/").at(-1)!,
        content: { media: { mediaID: text(item.id) } },
        start,
        duration: end - start,
        sourceStart,
        speed,
        ...(freezeFrame ? { freezeFrame: true } : {}),
        role: text(item.role),
        mapID: placement.flattened ? null : filmoraString(c, 3),
        take: placement.flattened ? null : take ? take.folder + take.base : null,
        ...(placement.template
          ? {
              tags: [
                placement.template === "filmora-template-sound"
                  ? placement.template
                  : `filmora-template:${placement.template}`,
              ],
            }
          : {}),
        colour: [],
        ...(placement.head ? { head: placement.head } : {}),
        ...(placement.tail ? { tail: placement.tail } : {}),
      };
      if (track.kind === "video") {
        const properties = filmoraVideo(
          c,
          {
            id: clip.id,
            duration: clip.duration,
            sourceStart: image
              ? number(speedNode?.offset, filmoraTicks(c.inPoint ?? 0)) + trimmedSource
              : sourceStart,
            speed,
            camera: item.role === "camera",
          },
          b.warnings,
        );
        clip.video = properties.video;
        clip.keyframes = properties.keyframes;
        clip.colour = properties.colour;
        if (placement.transform) {
          const transform = object(clip.video.transform),
            position = object(transform.position);
          clip.video.transform = {
            ...transform,
            position: {
              x:
                placement.transform.position.x +
                (number(position.x) - 0.5) * placement.transform.scale,
              y:
                placement.transform.position.y +
                (number(position.y) - 0.5) * placement.transform.scale,
            },
            scale: number(transform.scale) * placement.transform.scale,
          };
        }
      } else clip.audio = filmoraAudio(c, clip.duration, b.warnings);
      place(track, clip);
    }
  }
  for (const item of media.values()) {
    const clips = planned
      .filter((t) => t.kind === "video")
      .flatMap((t) => t.lanes.flat())
      .filter((c) => c.content.media != null && object(c.content.media).mediaID === item.id);
    const signature = (effects: FilmoraMappedEffect[]) =>
      JSON.stringify(effects.map(({ type, params, enabled }) => ({ type, params, enabled })));
    if (
      clips.length &&
      clips[0]!.colour.length &&
      new Set(clips.map((c) => signature(c.colour))).size === 1
    ) {
      item.look = clips[0]!.colour.map((e, i) => ({ ...e, id: `fx_look_${String(item.id)}_${i}` }));
      for (const clip of clips) clip.colour = [];
      b.warnings.push(
        "A colour grade shared by every clip of a file was moved onto that file's look.",
      );
    }
    b.media(item);
  }
  const usedNames = new Set<string>();
  const unique = (base: string) => {
    let name = base,
      i = 2;
    while (usedNames.has(name.toLowerCase())) name = `${base} ${i++}`;
    usedNames.add(name.toLowerCase());
    return name;
  };
  const category = (role: string, kind: string) =>
    kind === "audio"
      ? ({ camera: "Voice", screen: "Screen audio", music: "Music", sfx: "SFX" }[role] ?? "Audio")
      : ({
          text: "Text",
          camera: "Camera",
          screen: "Screen",
          broll: "B-roll",
          graphic: "Graphics",
          sticker: "Stickers",
          image: "Images",
        }[role] ?? "B-roll");
  const nonempty = planned.filter((t) => t.lanes.length);
  const ordered = [
    ...nonempty.filter((t) => t.kind === "video"),
    ...nonempty
      .filter((t) => t.kind === "audio" && t.linked != null)
      .sort((a, c) => a.linked! - c.linked! || a.index - c.index),
    ...nonempty.filter((t) => t.kind === "audio" && t.linked == null),
  ];
  for (const track of ordered) {
    const clips = track.lanes.flat();
    const counts = new Map<string, number>();
    for (const clip of clips) {
      const key = category(clip.role, track.kind);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const priority =
      track.kind === "video"
        ? ["Camera", "Screen", "Text", "Graphics", "B-roll", "Images", "Stickers"]
        : ["Voice", "Screen audio", "Music", "SFX", "Audio"];
    let base =
      [...counts].sort(
        (a, c) => c[1] - a[1] || priority.indexOf(a[0]) - priority.indexOf(c[0]),
      )[0]?.[0] ?? (track.kind === "video" ? "Video" : "Audio");
    if (
      track.kind === "video" &&
      Math.min(counts.get("Camera") ?? 0, counts.get("Screen") ?? 0) >= 0.2 * clips.length &&
      clips.length
    )
      base = "Main";
    if (track.kind === "audio" && counts.has("Voice")) base = "Voice";
    if (track.node.templateSounds === true) base = "Template sounds";
    if (base === "Audio" && track.linked != null) {
      const video = planned[track.linked];
      if (video?.names[0]) base = `${video.names[0]} audio`;
    }
    track.names = track.lanes.map((_, lane) => unique(lane ? `${base} extra` : base));
  }
  const allClips = planned.flatMap((t) => t.lanes.flat());
  const parents = new Map(allClips.map((c) => [c.id, c.id]));
  const root = (id: string): string => {
    let current = id;
    while (parents.get(current) !== current) current = parents.get(current)!;
    return current;
  };
  const keys = new Map<string, string>();
  for (const clip of allClips)
    for (const key of [clip.mapID && `map:${clip.mapID}`, clip.take && `take:${clip.take}`]) {
      if (!key) continue;
      const rangeKey = `${key}:${Time.fromSeconds(clip.start).flicks}:${Time.fromSeconds(clip.duration).flicks}`;
      const other = keys.get(rangeKey);
      if (other) parents.set(root(clip.id), root(other));
      else keys.set(rangeKey, clip.id);
    }
  const groups = new Map<string, PlannedClip[]>();
  for (const clip of allClips) {
    const id = root(clip.id);
    const group = groups.get(id) ?? [];
    group.push(clip);
    groups.set(id, group);
  }
  for (const [id, clips] of groups)
    if (clips.length > 1) for (const clip of clips) clip.linkGroup = `link_wfp_${id}`;
  for (const track of ordered)
    for (const [laneIndex, lane] of track.lanes.entries()) {
      const id = `trk_wfp_${track.index}_${laneIndex}`;
      b.track(id, track.kind, track.names[laneIndex]!);
      const trackClips = track.lanes.flat();
      const takeCount = trackClips.filter((c) => ["camera", "screen"].includes(c.role)).length;
      const speechTrack = takeCount >= trackClips.length / 2 && takeCount > 0;
      for (const {
        role,
        mapID: _map,
        take: _take,
        colour,
        head: _head,
        tail: _tail,
        ...clip
      } of lane) {
        if (clip.video && colour.length)
          clip.video.effects = [
            ...colour,
            ...(Array.isArray(clip.video.effects) ? clip.video.effects : []),
          ];
        if (
          track.kind === "audio" &&
          (speechTrack || ["camera", "other"].includes(role)) &&
          !options.keepLevels
        ) {
          clip.audio = { ...clip.audio, gainDB: 0, normalizeTo: -20 };
          b.warnings.push(
            "Speech was normalised to -20 LUFS with no gain instead of Filmora's level.",
          );
        }
        b.clip(id, clip);
      }
      const byID = new Map([...media.values()].map((item) => [text(item.id), item]));
      for (const transition of filmoraTransitions(
        lane,
        track.kind === "audio",
        byID,
        { numerator: number(rate[0]), denominator: number(rate[1]) },
        b.warnings,
      ))
        b.commands.push({ addTransition: { trackID: id, transition } });
      b.commands.push({
        updateTrack: {
          trackID: id,
          patch: {
            rippleMode: speechTrack ? "cut" : "follow",
            muted: track.kind === "audio" && track.node.mute === true,
            hidden: track.kind === "video" && track.node.mute === true,
            locked: track.node.locked === true,
          },
        },
      });
    }
  const extraPath = `${prefix}Medias/${mediaID}/extra.json`;
  if (Object.hasOwn(entries, extraPath)) {
    const extra = read(`Medias/${mediaID}/extra.json`);
    const mapID = filmoraString(timeline, 3);
    for (const [key, value] of Object.entries(object(extra.allMarkersInfo ?? {}))) {
      if (key === "beatDetectInfo") continue;
      const markers = list(value);
      if (key !== mapID) {
        if (markers.length)
          b.warnings.push(
            `${markers.length} marker(s) on clips or other timelines weren't imported.`,
          );
        continue;
      }
      for (const [index, raw] of markers.entries()) {
        const marker = object(raw);
        if (marker.position == null) continue;
        b.commands.push({
          addMarker: {
            marker: {
              id: `mk_wfp_${index}`,
              time: filmoraTicks(marker.position),
              name: marker.name || "Marker",
              kind: "marker",
              ...(marker.comments ? { note: text(marker.comments) } : {}),
            },
          },
        });
      }
    }
  }
  return b.finish("filmora");
}
