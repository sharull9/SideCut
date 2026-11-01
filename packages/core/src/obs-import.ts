import { Schema } from "effect";
import { builder } from "./import-builder";
import { ProjectCoordinator } from "./coordinator";
import { LiveStudio } from "./live-studio";
import { safeArchivePath } from "./archive";

const label = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200));
const sourceSchema = Schema.Struct({
  name: label,
  id: label,
  uuid: Schema.optionalKey(label),
  versioned_id: Schema.optionalKey(label),
  settings: Schema.JsonObject,
  filters: Schema.optionalKey(Schema.Array(Schema.JsonObject)),
});
const collectionSchema = Schema.Struct({
  name: label,
  current_scene: Schema.optionalKey(label),
  sources: Schema.Array(sourceSchema),
  scene_order: Schema.optionalKey(Schema.Array(Schema.Struct({ name: label }))),
});
const vector = Schema.Struct({ x: Schema.Finite, y: Schema.Finite });
const itemSchema = Schema.Struct({
  name: Schema.optionalKey(label),
  source_uuid: Schema.optionalKey(label),
  visible: Schema.optionalKey(Schema.Boolean),
  locked: Schema.optionalKey(Schema.Boolean),
  group_item_backup: Schema.optionalKey(Schema.Boolean),
  pos: Schema.optionalKey(vector),
  scale: Schema.optionalKey(vector),
  rot: Schema.optionalKey(Schema.Finite),
  align: Schema.optionalKey(Schema.Int),
  bounds_type: Schema.optionalKey(Schema.Int),
  crop_left: Schema.optionalKey(Schema.Int),
  crop_right: Schema.optionalKey(Schema.Int),
  crop_top: Schema.optionalKey(Schema.Int),
  crop_bottom: Schema.optionalKey(Schema.Int),
  blend_type: Schema.optionalKey(Schema.String),
  blend_method: Schema.optionalKey(Schema.String),
  show_transition: Schema.optionalKey(Schema.JsonObject),
  hide_transition: Schema.optionalKey(Schema.JsonObject),
});
type Source = typeof sourceSchema.Type;
export type OBSImage = { path: string; width: number; height: number };
export type OBSImages = ReadonlyMap<string, OBSImage | { error: string }>;
export const obsSourceKind = (source: Source) => source.versioned_id ?? source.id;
export function obsCollection(input: unknown) {
  const collection = Schema.decodeUnknownSync(collectionSchema)(input);
  if (
    collection.sources.length > 1000 ||
    new Set(collection.sources.map((s) => s.name)).size !== collection.sources.length
  )
    throw new Error("OBS collections need at most 1,000 uniquely named sources.");
  const ids = collection.sources.flatMap((s) => (s.uuid ? [s.uuid] : []));
  if (new Set(ids).size !== ids.length) throw new Error("Duplicate OBS source UUID.");
  return collection;
}

export function obsImageRequests(collection: ReturnType<typeof obsCollection>) {
  const used = new Set<string>();
  const byUUID = new Map(
    collection.sources.flatMap((source) =>
      source.uuid ? [[source.uuid, source.name] as const] : [],
    ),
  );
  let count = 0;
  for (const source of collection.sources.filter((entry) => entry.id === "scene")) {
    const items = Schema.decodeUnknownSync(Schema.Array(itemSchema))(source.settings.items ?? []);
    if ((count += items.length) > 1000) throw new Error("OBS import exceeds 1,000 scene items.");
    if (source.filters?.length || source.settings.custom_size === true) continue;
    for (const item of items) {
      if (item.group_item_backup) continue;
      const name = item.source_uuid ? byUUID.get(item.source_uuid) : item.name;
      if (name) used.add(name);
    }
  }
  return collection.sources.filter(
    (source) =>
      used.has(source.name) && obsSourceKind(source) === "image_source" && !source.filters?.length,
  );
}

/** Read only video settings. Output credentials, device IDs and arbitrary INI sections are discarded. */
export function obsProfile(encoded?: string) {
  const video = new Map<string, string>();
  if (encoded !== undefined) {
    if (encoded.length > 65536) throw new Error("OBS profile exceeds 64 KiB.");
    let section = "";
    for (const raw of encoded.replace(/^\uFEFF/, "").split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || /^[;#]/.test(line)) continue;
      const heading = /^\[([^\]]+)\]$/.exec(line);
      if (heading) {
        section = heading[1]!;
        continue;
      }
      if (section !== "Video") continue;
      const equal = line.indexOf("=");
      if (equal < 1) throw new Error("Malformed OBS video profile.");
      const key = line.slice(0, equal).trim();
      if (video.has(key)) throw new Error("Duplicate OBS video profile setting.");
      video.set(key, line.slice(equal + 1).trim());
    }
  }
  const integer = (key: string, fallback: number) => {
    const raw = video.get(key);
    if (raw !== undefined && !/^\d+$/.test(raw)) throw new Error(`Invalid OBS ${key}.`);
    const value = raw === undefined ? fallback : Number(raw);
    if (!Number.isSafeInteger(value)) throw new Error(`Invalid OBS ${key}.`);
    return value;
  };
  const width = integer("BaseCX", 1920),
    height = integer("BaseCY", 1080);
  if (width < 1 || height < 1 || width > 3840 || height > 3840 || width * height > 3840 * 2160)
    throw new Error("OBS base canvas exceeds the supported 4K pixel limit.");
  const mode = integer("FPSType", 0);
  const common = video.get("FPSCommon") ?? "30";
  const rates: Record<string, { numerator: number; denominator: number }> = {
    "29.97": { numerator: 30000, denominator: 1001 },
    "59.94": { numerator: 60000, denominator: 1001 },
    "23.976": { numerator: 24000, denominator: 1001 },
    "23.98": { numerator: 24000, denominator: 1001 },
    "24 NTSC": { numerator: 24000, denominator: 1001 },
  };
  let frameRate;
  if (mode === 2)
    frameRate = { numerator: integer("FPSNum", 30), denominator: integer("FPSDen", 1) };
  else if (mode === 1) frameRate = { numerator: integer("FPSInt", 30), denominator: 1 };
  else if (mode === 0)
    frameRate = rates[common] ?? {
      numerator: /^\d+$/.test(common) ? Number(common) : NaN,
      denominator: 1,
    };
  else throw new Error("Unsupported OBS frame-rate mode.");
  if (
    !Number.isSafeInteger(frameRate.numerator) ||
    frameRate.numerator < 1 ||
    frameRate.denominator < 1 ||
    frameRate.numerator > 1000000 ||
    frameRate.denominator > 1000000 ||
    frameRate.numerator / frameRate.denominator < 1 ||
    frameRate.numerator / frameRate.denominator > 120
  )
    throw new Error("Invalid OBS frame rate.");
  return {
    settings: { width, height, frameRate },
    warnings: [
      ...(encoded === undefined
        ? ["No OBS profile supplied; using a 1920×1080 canvas at 30 fps."]
        : []),
      "Only profile base canvas and frame rate are imported; output, audio, encoder, hotkeys and account settings are not imported.",
    ],
  };
}

/** Independent conversion of OBS's saved item fields; no OBS plugin/code execution. */
export function importOBS(
  input: unknown,
  options: { profile?: string; scene?: string; duration?: number; images?: OBSImages } = {},
) {
  const collection = obsCollection(input);
  const profile = obsProfile(options.profile);
  const { width, height } = profile.settings;
  const duration = options.duration ?? 10;
  if (!Number.isFinite(duration) || duration < 0.1 || duration > 3600)
    throw new Error("OBS scene duration must be 0.1–3,600 seconds.");
  const sources = new Map(collection.sources.map((source) => [source.name, source]));
  const uuids = new Map(
    collection.sources.flatMap((source) => (source.uuid ? [[source.uuid, source] as const] : [])),
  );
  const scenes = collection.sources.filter((source) => source.id === "scene");
  if (!scenes.length || scenes.length > 100) throw new Error("OBS import needs 1–100 scenes.");
  const order = collection.scene_order?.map((row) => row.name) ?? scenes.map((scene) => scene.name);
  if (
    new Set(order).size !== order.length ||
    order.some((name) => !scenes.some((scene) => scene.name === name))
  )
    throw new Error("Invalid OBS scene order.");
  const ordered = [
    ...order,
    ...scenes.map((scene) => scene.name).filter((name) => !order.includes(name)),
  ];
  const selected = options.scene ?? collection.current_scene ?? ordered[0]!;
  if (!scenes.some((scene) => scene.name === selected || scene.uuid === selected))
    throw new Error("Selected OBS scene is unavailable.");
  const selectedSource = scenes.find(
    (scene) => scene.name === selected || scene.uuid === selected,
  )!;
  const warnings = [...profile.warnings];
  const results = [];
  let totalItems = 0;
  for (const name of ordered) {
    const scene = sources.get(name)!;
    const b = builder(`${collection.name} — ${name}`, profile.settings);
    const items = Schema.decodeUnknownSync(Schema.Array(itemSchema))(scene.settings.items ?? []);
    if ((totalItems += items.length) > 1000)
      throw new Error("OBS import exceeds 1,000 scene items.");
    const warn = (source: string, reason: string) =>
      warnings.push(`${name} / ${source}: ${reason}`);
    if (scene.filters?.length || scene.settings.custom_size === true) {
      warn(name, "Scene filters/custom canvas are unsupported; scene skipped.");
      if (scene === selectedSource)
        throw new Error("Selected OBS scene uses unsupported scene filters or a custom canvas.");
      continue;
    }
    // Both OBS scene items and SideCut video tracks paint from bottom to top.
    for (const [index, item] of items.entries()) {
      if (item.group_item_backup) continue;
      const source = item.source_uuid
        ? uuids.get(item.source_uuid)
        : item.name
          ? sources.get(item.name)
          : undefined;
      if (!source) {
        warn(item.name ?? "Unknown", "Source reference unavailable; item skipped.");
        continue;
      }
      const kind = obsSourceKind(source);
      if (source.filters?.length) {
        warn(source.name, "Source filters unsupported; item skipped.");
        continue;
      }
      const colorSource = /^color_source(?:_v[123])?$/.test(kind);
      if (!colorSource && kind !== "image_source") {
        warn(source.name, `Unsupported source type ${source.id}; item skipped.`);
        continue;
      }
      const scale = item.scale ?? { x: 1, y: 1 };
      const alignment = item.align ?? 5;
      if (
        (item.bounds_type ?? 0) !== 0 ||
        scale.x <= 0 ||
        scale.x > 100 ||
        Math.abs(scale.x - scale.y) > 0.000001 ||
        ![0, 1, 2, 4, 5, 6, 8, 9, 10].includes(alignment) ||
        (item.blend_type && item.blend_type !== "normal") ||
        (item.blend_method && item.blend_method !== "default") ||
        (item.show_transition &&
          Object.keys(item.show_transition).some((key) => key !== "duration")) ||
        (item.hide_transition &&
          Object.keys(item.hide_transition).some((key) => key !== "duration"))
      ) {
        warn(
          source.name,
          "Bounds, flip, nonuniform scale, blending or item transition unsupported; item skipped.",
        );
        continue;
      }
      const image = options.images?.get(source.name);
      if (!colorSource && (!image || "error" in image)) {
        warn(
          source.name,
          image && "error" in image
            ? image.error
            : "Image needs an approved local PNG resource; item skipped.",
        );
        continue;
      }
      const legacyColor = kind === "color_source" || kind.endsWith("_v1");
      const sw = colorSource
        ? (source.settings.width ?? (legacyColor ? 400 : 1920))
        : image && "path" in image
          ? image.width
          : 0;
      const sh = colorSource
        ? (source.settings.height ?? (legacyColor ? 400 : 1080))
        : image && "path" in image
          ? image.height
          : 0;
      if (
        typeof sw !== "number" ||
        typeof sh !== "number" ||
        !Number.isInteger(sw) ||
        !Number.isInteger(sh) ||
        sw < 1 ||
        sh < 1 ||
        sw > 8192 ||
        sh > 8192 ||
        sw * sh > 16777216
      )
        throw new Error("Invalid or oversized OBS source dimensions.");
      const left = item.crop_left ?? 0,
        top = item.crop_top ?? 0,
        right = item.crop_right ?? 0,
        bottom = item.crop_bottom ?? 0;
      if (
        [left, top, right, bottom].some((value) => value < 0) ||
        left + right >= sw ||
        top + bottom >= sh
      ) {
        warn(source.name, "Invalid/empty crop; item skipped.");
        continue;
      }
      const naturalScale = colorSource ? Math.max(sw / width, sh / height) : 1;
      const virtualWidth = colorSource ? width * naturalScale : sw;
      const virtualHeight = colorSource ? height * naturalScale : sh;
      const scaledWidth = Math.trunc((sw - left - right) * scale.x),
        scaledHeight = Math.trunc((sh - top - bottom) * scale.x);
      const originX = alignment & 1 ? 0 : alignment & 2 ? scaledWidth : Math.trunc(scaledWidth / 2);
      const originY =
        alignment & 4 ? 0 : alignment & 8 ? scaledHeight : Math.trunc(scaledHeight / 2);
      const dx = (virtualWidth / 2 - left) * scale.x - originX;
      const dy = (virtualHeight / 2 - top) * scale.x - originY;
      const radians = ((item.rot ?? 0) * Math.PI) / 180;
      const pos = item.pos ?? { x: 0, y: 0 };
      if (
        Math.abs(pos.x) > 1000000 ||
        Math.abs(pos.y) > 1000000 ||
        Math.abs(item.rot ?? 0) > 360000
      )
        throw new Error("OBS item transform exceeds its limits.");
      const video = {
        transform: {
          position: {
            x: (pos.x + dx * Math.cos(radians) - dy * Math.sin(radians)) / width,
            y: (pos.y + dx * Math.sin(radians) + dy * Math.cos(radians)) / height,
          },
          scale: colorSource ? naturalScale * scale.x : scale.x / Math.min(width / sw, height / sh),
          rotation: item.rot ?? 0,
        },
        crop: {
          left: left / virtualWidth,
          top: top / virtualHeight,
          right: 1 - (sw - right) / virtualWidth,
          bottom: 1 - (sh - bottom) / virtualHeight,
        },
      };
      let content;
      if (colorSource) {
        const color = source.settings.color ?? 4294967295;
        if (
          typeof color !== "number" ||
          !Number.isInteger(color) ||
          color < 0 ||
          color > 4294967295
        )
          throw new Error("Invalid OBS color.");
        content = {
          solid: {
            color: {
              r: (color & 255) / 255,
              g: ((color >>> 8) & 255) / 255,
              b: ((color >>> 16) & 255) / 255,
              a: (color >>> 24) / 255,
            },
          },
        };
      } else {
        if (!image || !("path" in image)) throw new Error("Image metadata unavailable.");
        const mediaID = `obs_media_${index}`;
        b.media({
          id: mediaID,
          path: safeArchivePath(image.path),
          kind: "image",
          role: "image",
          width: sw,
          height: sh,
          hasVideo: true,
          hasAudio: false,
        });
        content = { media: { mediaID } };
      }
      const trackID = `obs_track_${index}`;
      b.track(trackID, "video", source.name);
      b.clip(trackID, {
        id: `obs_clip_${index}`,
        name: source.name,
        start: 0,
        duration,
        content,
        video,
        enabled: item.visible !== false,
      });
      if (item.locked) b.commands.push({ updateTrack: { trackID, patch: { locked: true } } });
    }
    const imported = b.finish("obs");
    if (scene === selectedSource && !imported.report.clips)
      throw new Error("Selected OBS scene has no supported items; nothing was imported.");
    results.push({ name, imported });
  }
  if (
    collection.sources.some(
      (source) =>
        source.id !== "scene" &&
        !["image_source", "color_source", "color_source_v2", "color_source_v3"].includes(source.id),
    )
  )
    warnings.push(
      "Only scene color/PNG image layers are imported; live devices, audio, browser/media sources and nested groups/scenes are not activated.",
    );
  const studio = new LiveStudio();
  for (const [index, result] of results.entries())
    studio.save({
      id: `obs_scene_${index}`,
      name: result.name.slice(0, 100),
      project: result.imported.file.project,
      expectedRevision: studio.currentRevision,
    });
  const selectedIndex = results.findIndex((result) => result.name === selectedSource.name);
  studio.switch({ id: `obs_scene_${selectedIndex}`, expectedRevision: studio.currentRevision });
  const chosen = results[selectedIndex]!.imported;
  const report = {
    ...chosen.report,
    warnings,
    scenes: results.length,
    selectedScene: selectedSource.name,
    supportedSources: ["color_source", "image_source (local PNG)"],
    duration,
  };
  const coordinator = new ProjectCoordinator(chosen.file);
  coordinator.apply({
    label: "Import OBS scenes and diagnostics",
    commands: [
      {
        updateProject: {
          patch: {
            metadata: {
              "sidecut.liveStudio": studio.serialize(),
              sidecutImportReport: JSON.stringify(report),
            },
          },
        },
      },
    ],
  });
  return { file: coordinator.projectFile(), report };
}
