// TandemAPI/Segments.swift. Notice: tests/fixtures/tandem/TANDEM-LICENSE.
import { decodeTemplate, type Template } from "./templates";
import { Time } from "@sidecut/contracts/time";
import type { Project, Clip, MediaItem } from "@sidecut/contracts/project";
import { assetUses, type AssetUse } from "./asset-use";
import { decodeAsset } from "@sidecut/contracts/assets";
import { QueryError } from "./project-queries";
import { textContent, resolveText } from "./text";
export interface SavedSegment {
  version: 1;
  id: string;
  name: string;
  savedFrom: string;
  savedAt: string;
  storageID?: string;
  notes: string[];
  template: Template;
  assets: AssetUse[];
  resources: { key: string; path: string; optional?: boolean }[];
}
const jsonObject = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
function lutPaths(value: unknown, found = new Set<string>()) {
  if (Array.isArray(value)) value.forEach((v) => lutPaths(v, found));
  else if (value && typeof value === "object") {
    const v = jsonObject(value);
    if (v.type === "lut" && typeof jsonObject(v.params).path === "string")
      found.add(String(jsonObject(v.params).path));
    Object.values(v).forEach((x) => lutPaths(x, found));
  }
  return found;
}
function rewriteLUTs<T>(value: T, paths: ReadonlyMap<string, string>): T {
  if (Array.isArray(value)) return value.map((v) => rewriteLUTs(v, paths)) as T;
  if (value instanceof Time) return value;
  if (value && typeof value === "object") {
    const v = jsonObject(value);
    const copy = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, rewriteLUTs(x, paths)]));
    if (v.type === "lut" && typeof jsonObject(v.params).path === "string")
      copy.params = {
        ...jsonObject(copy.params),
        path: paths.get(String(jsonObject(v.params).path)) ?? jsonObject(v.params).path,
      };
    return copy as T;
  }
  return value;
}
export interface SegmentField {
  clipID: string;
  label?: string;
  key?: string;
}

export function makeSegment(
  project: Project,
  ids: readonly string[],
  name: string,
  now = "",
  fields: readonly SegmentField[] = [],
): SavedSegment {
  const clean = name
    .trim()
    .replace(/[\\/:]/g, "-")
    .replace(/^\.+/, "")
    .slice(0, 80)
    .trim();
  if (!clean) throw new QueryError("badRequest", "A segment needs a name.");
  const tracks = [...project.videoTracks, ...project.audioTracks],
    all = tracks.flatMap((track) => track.clips.map((clip) => ({ track, clip }))),
    selected = new Set(ids);
  if (!ids.length || ids.some((id) => !all.some((v) => v.clip.id === id)))
    throw new QueryError(
      ids.length ? "notFound" : "badRequest",
      "Select existing clips to save a segment.",
    );
  const order = [...project.videoTracks].reverse().concat(project.audioTracks);
  const picked = all
      .filter((v) => selected.has(v.clip.id))
      .sort(
        (a, b) =>
          order.indexOf(a.track) - order.indexOf(b.track) ||
          a.clip.start.seconds - b.clip.start.seconds,
      ),
    start = Math.min(...picked.map((v) => v.clip.start.seconds)),
    end = Math.max(...picked.map((v) => v.clip.start.seconds + v.clip.duration.seconds));
  const resources: SavedSegment["resources"] = [],
    media = new Map<string, MediaItem>(),
    uses = assetUses(project),
    notes: string[] = [];
  for (const { clip } of picked) {
    const id = jsonObject(clip.content.media).mediaID;
    if (typeof id === "string" && !media.has(id)) {
      const item = project.media.find((m) => m.id === id);
      if (!item) throw new QueryError("notFound", "Segment media is missing from the project.");
      const path = `media/${media.size}-${item.path
        .split(/[\\/]/)
        .at(-1)!
        .replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      media.set(id, { ...item, id: "", takeID: null, takeOffset: null, path });
      resources.push({ key: id, path });
    }
  }
  const luts = lutPaths(picked.map((v) => v.clip));
  for (const item of media.values()) lutPaths(item.look, luts);
  const lutMap = new Map<string, string>();
  for (const path of luts) {
    const target = `luts/${lutMap.size}-${path
      .split(/[\\/]/)
      .at(-1)!
      .replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    lutMap.set(path, target);
    resources.push({ key: `lut:${path}`, path: target });
  }
  const assets: AssetUse[] = [];
  const fonts = new Set(
    picked.flatMap(({ clip }) => {
      const text = textContent(clip);
      return text ? [resolveText(text).style.font.toLowerCase()] : [];
    }),
  );
  const usedIDs = new Set<string>();
  for (const item of media.values())
    if (item.asset) {
      const asset = decodeAsset(item.asset);
      assets.push({ asset, mediaID: item.id, path: item.path });
      usedIDs.add(asset.id);
    }
  for (const use of uses) {
    if (usedIDs.has(use.asset.id)) continue;
    if (
      (use.asset.kind === "font" &&
        fonts.has((use.asset.fontFamily ?? use.asset.name).toLowerCase())) ||
      (use.asset.kind === "lut" && use.path && luts.has(use.path))
    ) {
      assets.push(use);
      usedIDs.add(use.asset.id);
      resources.push({
        key: `asset-file:${use.asset.id}`,
        path: `installed/${resources.length}-${use.asset.providerID.replace(/[^a-zA-Z0-9._-]/g, "_")}`,
      });
    }
  }
  for (const use of assets)
    resources.push({
      key: `asset-licence:${use.asset.id}`,
      path: `licences/${resources.length}.json`,
      optional: true,
    });
  const trackNames = new Map<string, string>(),
    usedNames = new Set<string>();
  for (const { track } of picked)
    if (!trackNames.has(track.id)) {
      let trackName = track.name;
      for (let n = 2; usedNames.has(`${track.kind}:${trackName.toLowerCase()}`); n++)
        trackName = `${track.name} ${n}`;
      usedNames.add(`${track.kind}:${trackName.toLowerCase()}`);
      trackNames.set(track.id, trackName);
    }
  const clips = picked.map(({ track, clip }) => {
    const item = media.get(String(jsonObject(clip.content.media).mediaID)),
      tags = clip.tags.filter((t) => !t.startsWith("template:"));
    for (const a of assets)
      if ((item?.asset && decodeAsset(item.asset).id === a.asset.id) || a.asset.kind === "lut")
        if (!tags.includes(`asset:${a.asset.id}`)) tags.push(`asset:${a.asset.id}`);
    const { linkGroup: _link, ...rest } = clip;
    return {
      track: trackNames.get(track.id)!,
      trackKind: track.kind,
      offset: clip.start.subtract(Time.fromSeconds(start)),
      clip: rewriteLUTs({ ...rest, start: new Time(0n), tags } as Clip, lutMap),
      mediaPath: item?.path ?? null,
      media: item ? rewriteLUTs(item, lutMap) : null,
    };
  });
  const templateFields: Template["fields"] = [],
    keys = new Set<string>();
  for (const [number, choice] of fields.entries()) {
    const item = clips.find((c) => c.clip.id === choice.clipID);
    if (!item)
      throw new QueryError("notFound", `Clip ${choice.clipID} isn't one of the clips being saved.`);
    const text = textContent(item.clip);
    if (!text) throw new QueryError("badRequest", `Clip ${choice.clipID} isn't a title.`);
    const label = choice.label ?? item.clip.name ?? `Text ${number + 1}`;
    const words = (choice.key ?? label).match(/[\p{L}\p{N}]+/gu) ?? [];
    const base =
      words
        .map((w, i) => (i ? w[0]!.toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase()))
        .join("") || "text";
    let key = base;
    for (let n = 2; keys.has(key); n++) key = `${base}${n}`;
    keys.add(key);
    templateFields.push({ key, label, defaultValue: text.text });
    item.clip = { ...item.clip, content: { text: { ...text, text: `{{${key}}}` } } };
  }
  for (const item of clips) {
    const text = textContent(item.clip);
    for (const match of text?.text.matchAll(/{{(.*?)}}/g) ?? []) {
      const key = match[1]!.trim();
      if (key && !keys.has(key)) {
        keys.add(key);
        templateFields.push({ key, label: key, defaultValue: "" });
      }
    }
  }
  let halfSaved = 0;
  const places = new Map(picked.map((v, i) => [v.clip.id, i])),
    transitions: Template["transitions"] = [];
  for (const track of tracks)
    for (const t of track.transitions) {
      const from = t.fromClipID == null ? null : places.get(String(t.fromClipID)),
        to = t.toClipID == null ? null : places.get(String(t.toClipID));
      if (from == null && to == null) continue;
      if ((t.fromClipID != null && from == null) || (t.toClipID != null && to == null)) {
        halfSaved++;
        continue;
      }
      transitions.push({
        from: from ?? null,
        to: to ?? null,
        sound: places.get(String(t.soundClipID)) ?? null,
        type: String(t.type),
        direction: typeof t.direction === "string" ? t.direction : null,
        duration: Number(t.duration),
      });
    }
  if (halfSaved)
    notes.push(
      `${halfSaved === 1 ? "A transition" : `${halfSaved} transitions`} to a clip that isn't in the segment ${halfSaved === 1 ? "is" : "are"} left out.`,
    );
  return {
    version: 1,
    id: clean,
    name: name.trim(),
    savedFrom: project.name,
    savedAt: now,
    notes,
    template: {
      id: `segment:${clean}`,
      name: name.trim(),
      duration: Time.fromSeconds(end - start),
      fields: templateFields,
      clips,
      transitions,
    },
    assets,
    resources,
  };
}
export function decodeSegment(value: unknown): SavedSegment {
  const v = jsonObject(value);
  if (
    v.version !== 1 ||
    typeof v.id !== "string" ||
    typeof v.name !== "string" ||
    !Array.isArray(v.resources) ||
    !Array.isArray(v.assets)
  )
    throw new Error("Unsupported or invalid saved segment.");
  const template = decodeTemplate(v.template);
  if (template.duration.flicks <= 0n || !template.clips.length)
    throw new Error("Segment has no positive duration or clips.");
  const resources = v.resources.map((r) => {
    const e = jsonObject(r);
    if (
      typeof e.key !== "string" ||
      typeof e.path !== "string" ||
      e.path.startsWith("/") ||
      e.path.includes("\\") ||
      e.path.split("/").some((p) => p === ".." || p === "." || !p) ||
      e.path.includes(":")
    )
      throw new Error("Segment resources must use relative paths.");
    return { key: e.key, path: e.path, ...(e.optional === true ? { optional: true } : {}) };
  });
  return {
    version: 1,
    id: v.id,
    name: v.name,
    savedFrom: String(v.savedFrom ?? ""),
    savedAt: String(v.savedAt ?? ""),
    ...(typeof v.storageID === "string" ? { storageID: v.storageID } : {}),
    notes: Array.isArray(v.notes) ? v.notes.map(String) : [],
    template,
    resources,
    assets: v.assets.map((a) => {
      const u = jsonObject(a);
      return {
        asset: decodeAsset(u.asset),
        ...(typeof u.mediaID === "string" ? { mediaID: u.mediaID } : {}),
        ...(typeof u.path === "string" ? { path: u.path } : {}),
      };
    }),
  };
}
export function segmentPrefix(segment: SavedSegment) {
  return `segments/${encodeURIComponent(segment.id)}/${encodeURIComponent(segment.storageID ?? (segment.savedAt || "legacy"))}/`;
}
export function insertableSegment(segment: SavedSegment) {
  const prefix = segmentPrefix(segment),
    paths = new Map(segment.resources.map((r) => [r.path, `${prefix}${r.path}`]));
  const template = rewriteLUTs(segment.template, paths);
  return JSON.parse(
    JSON.stringify({
      ...template,
      clips: template.clips.map((c) => ({
        ...c,
        mediaPath: c.mediaPath ? `${prefix}${c.mediaPath}` : null,
        media: c.media ? { ...c.media, path: `${prefix}${c.media.path}` } : null,
      })),
    }),
  ) as Record<string, unknown>;
}

export function segmentSummary(segment: SavedSegment, available: readonly string[]) {
  const folder = `indexeddb:sidecut-segments/${encodeURIComponent(segment.id)}`;
  const files = segment.template.clips.flatMap((c) => (c.mediaPath ? [c.mediaPath] : []));
  return {
    id: segment.id,
    name: segment.name,
    folder,
    duration: segment.template.duration.seconds,
    clips: segment.template.clips.length,
    tracks: [...new Set(segment.template.clips.map((c) => c.track))],
    fields: segment.template.fields,
    files: [...new Set(files)],
    missing: [...new Set(files)].filter((f) => !available.includes(f)),
    savedAt: segment.savedAt,
    savedFrom: segment.savedFrom,
  };
}
