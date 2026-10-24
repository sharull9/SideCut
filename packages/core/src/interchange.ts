// Reference: TandemImport at 735a9b8. Notice: tests/fixtures/tandem/TANDEM-LICENSE.
import { strFromU8 } from "fflate";
import { decodeProjectFile } from "@sidecut/contracts/project";
import { ProjectCoordinator } from "./coordinator";
import { readZip, safeArchivePath } from "./archive";

type ObjectValue = Record<string, unknown>;
export function object(value: unknown): ObjectValue {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected a JSON object.");
  return value as ObjectValue;
}
function list(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("Expected a JSON array.");
  return value;
}
function number(value: unknown, fallback?: number): number {
  if (value == null && fallback !== undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new Error("Expected a finite number.");
  return value;
}
function text(value: unknown): string {
  if (typeof value !== "string" || !value) throw new Error("Expected nonempty text.");
  return value;
}
export interface ImportReport {
  format: "edl" | "filmora";
  warnings: string[];
  clips: number;
  media: number;
}
function builder(name: string, settings: ObjectValue) {
  const coordinator = new ProjectCoordinator(
    decodeProjectFile({
      revision: 0,
      project: {
        id: `prj_${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`,
        name,
      },
    }),
  );
  const commands: unknown[] = [{ updateSettings: { patch: settings } }];
  const warnings: string[] = [];
  let clips = 0,
    media = 0;
  return {
    commands,
    warnings,
    track(id: string, kind: string, trackName: string) {
      commands.push({ addTrack: { id, kind, name: trackName } });
    },
    media(item: ObjectValue) {
      commands.push({ addMedia: { item } });
      media++;
    },
    clip(trackID: string, clip: ObjectValue) {
      commands.push({ insertClip: { trackID, clip } });
      clips++;
    },
    finish(format: ImportReport["format"]) {
      commands.push({
        updateProject: {
          patch: {
            metadata: { sidecutImportReport: JSON.stringify({ format, warnings, clips, media }) },
          },
        },
      });
      coordinator.apply({ label: `Import ${format}`, expectedRevision: 0, commands });
      return {
        file: coordinator.projectFile(),
        report: { format, warnings, clips, media } satisfies ImportReport,
      };
    },
  };
}

export function importEDL(input: unknown, configuration: unknown) {
  const edl = object(input),
    recipe = object(configuration);
  const takes = list(recipe.takes).map(object);
  if (!takes.length) throw new Error("The recipe needs at least one take.");
  const rate = number(recipe.frameRate, 30);
  const b = builder(text(recipe.name), {
    width: number(recipe.width, 1920),
    height: number(recipe.height, 1080),
    frameRate: { numerator: Math.round(rate * 1000), denominator: 1000 },
  });
  for (const [id, kind, name] of [
    ["screen", "video", "Screen"],
    ["camera", "video", "Camera"],
    ["broll", "video", "B-roll"],
    ["voice", "audio", "Voice"],
  ])
    b.track(`trk_${id}`, kind!, name!);
  const paths = new Map<string, string>();
  const media = (path: unknown, role: string) => {
    const root =
      recipe.root == null || recipe.root === "." ? "" : safeArchivePath(text(recipe.root));
    const value = safeArchivePath(`${root ? root + "/" : ""}${text(path)}`);
    if (!paths.has(value)) {
      const id = `med_${paths.size}`;
      paths.set(value, id);
      b.media({
        id,
        path: value,
        kind: "video",
        role,
        hasVideo: true,
        hasAudio: role === "camera",
        look: role === "camera" ? (recipe.cameraLook ?? []) : [],
      });
    }
    return paths.get(value)!;
  };
  const sources = takes.map((take, i) => {
    const start = number(take.start);
    if (start < 0 || (i > 0 && start <= number(takes[i - 1]!.start)))
      throw new Error("Take starts must increase.");
    return {
      start,
      camera: media(take.camera, "camera"),
      screen: take.screen == null ? null : media(take.screen, "screen"),
    };
  });
  let cursor = 0,
    sequence = 0;
  const clip = (
    track: string,
    id: string,
    at: number,
    source: number,
    duration: number,
    extra: ObjectValue = {},
  ) => {
    if (source < 0 || duration <= 0) throw new Error("Invalid source range.");
    b.clip(`trk_${track}`, {
      id: `clip_${sequence++}`,
      content: { media: { mediaID: id } },
      start: at,
      sourceStart: source,
      duration,
      ...extra,
    });
  };
  const segments = list(edl.segments).map(object);
  for (const [index, segment] of segments.entries()) {
    let start = number(segment.start),
      end = number(segment.end);
    let layout = text(segment.layout);
    for (const raw of recipe.cutAdjustments == null ? [] : list(recipe.cutAdjustments)) {
      const a = object(raw);
      if (a.start === start && a.end === end) {
        start = number(a.newStart);
        end = number(a.newEnd);
        break;
      }
    }
    for (const raw of recipe.layoutOverrides == null ? [] : list(recipe.layoutOverrides)) {
      const override = object(raw);
      if (start >= number(override.from) && start < number(override.to))
        layout = text(override.layout);
    }
    if (start < 0 || end <= start || !["cam", "screen"].includes(layout))
      throw new Error("Invalid EDL segment.");
    const takeIndex = sources.findLastIndex((sourceTake) => sourceTake.start <= start);
    const take = sources[takeIndex];
    if (!take) throw new Error("No recording session covers the segment.");
    const next = sources[takeIndex + 1];
    if (next && end > next.start) {
      end = next.start;
      b.warnings.push(`Segment ${index + 1} shortened at recording session boundary.`);
    }
    const duration = end - start,
      local = start - take.start;
    const offset = number(segment.screen_offset, 0);
    if (layout === "screen" && (!take.screen || local + offset < 0)) {
      layout = "cam";
      b.warnings.push(`Segment ${index + 1} has no usable screen; camera fills the frame.`);
    }
    const linkGroup = `link_${index}`;
    const pip =
      recipe.pip == null ? { x: 0.87, y: 0.77, scale: 0.35, cutout: true } : object(recipe.pip);
    clip("camera", take.camera, cursor, local, duration, {
      linkGroup,
      video:
        layout === "screen"
          ? {
              layoutPreset: "pipRight",
              transform: {
                position: { x: number(pip.x), y: number(pip.y) },
                scale: number(pip.scale),
              },
              cutout: { enabled: pip.cutout !== false },
            }
          : { layoutPreset: "full" },
    });
    clip("voice", take.camera, cursor, local, duration, {
      linkGroup,
      audio: recipe.voice ?? { normalizeTo: -20 },
    });
    if (take.screen && local + offset >= 0)
      clip("screen", take.screen, cursor, local + offset, duration, {
        linkGroup,
        enabled: layout === "screen",
      });
    for (const pair of segment.broll == null ? [] : list(segment.broll)) {
      const [at, dur] = list(pair).map((v) => number(v));
      if (!take.screen || at == null || dur == null || at < start || at + dur > end)
        throw new Error("B-roll must fit its segment and screen source.");
      clip("broll", take.screen, cursor + at - start, at - take.start + offset, dur);
    }
    cursor += duration;
  }
  for (const raw of edl.overlays == null ? [] : list(edl.overlays)) {
    const overlay = object(raw),
      at = number(overlay.tl),
      dur = number(overlay.dur),
      source = number(overlay.screen_at);
    const take = sources.findLast((sourceTake) => sourceTake.start <= source);
    if (!take?.screen || at < 0 || at + dur > cursor)
      throw new Error("Invalid overlay range or missing screen.");
    clip("broll", take.screen, at, source - take.start, dur);
  }
  for (const key of ["intro", "transitions", "inserts", "sections", "music", "sfx"])
    if (recipe[key] != null) b.warnings.push(`Unsupported recipe field: ${key}.`);
  return b.finish("edl");
}

export function importFilmora(bytes: Uint8Array) {
  const entries = readZip(bytes);
  const infoPath = Object.keys(entries).find((p) => p.endsWith("ProjectFolder/project_info.json"));
  if (!infoPath) throw new Error("Filmora archive has no ProjectFolder/project_info.json.");
  const prefix = infoPath.slice(0, -"project_info.json".length);
  const read = (path: string) => {
    const entry = entries[safeArchivePath(prefix + path)];
    if (!entry) throw new Error(`Filmora archive is missing ${path}.`);
    return object(JSON.parse(strFromU8(entry)));
  };
  const info = read("project_info.json"),
    mediaID = text(info.timeline_mediaId);
  safeArchivePath(mediaID);
  const doc = read(`Medias/${mediaID}/timeline.wesproj`);
  const timelines = list(doc.timelineInfos).map(object);
  const timeline = timelines.find((t) => t.timelineId === doc.currentTimelineId) ?? timelines[0];
  if (!timeline) throw new Error("Filmora project has no timeline.");
  const size = list(info.project_timeline_resolution ?? [1920, 1080]),
    rate = list(info.project_timeline_framerate ?? [30, 1]);
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
  const known = new Map<string, string>();
  let sequence = 0;
  const ticks = (v: unknown) => {
    const n = number(v);
    if (!Number.isSafeInteger(n)) throw new Error("Invalid Filmora tick value.");
    return n / 10000000;
  };
  for (const [index, rawTrack] of list(timeline.trackInfos).entries()) {
    const track = object(rawTrack),
      kind = track.trackType === 1 ? "video" : "audio",
      trackID = `trk_wfp_${index}`;
    b.track(trackID, kind, `${kind === "video" ? "Video" : "Audio"} ${index + 1}`);
    for (const raw of list(track.clipList ?? []).sort(
      (a, c) => number(object(a).tlBegin) - number(object(c).tlBegin),
    )) {
      const c = object(raw);
      if (![1, 2, 14, 15].includes(Number(c.type))) {
        b.warnings.push(`Unsupported Filmora clip type ${String(c.type)} on track ${index + 1}.`);
        continue;
      }
      const resource = resources.get(c.sourceUuid);
      const filename = resource?.filename ?? c.filename;
      if (typeof filename !== "string" || !filename) {
        b.warnings.push("Missing source filename; clip omitted.");
        continue;
      }
      let path = filename;
      if (filename.startsWith("file:"))
        path = decodeURIComponent(filename.replace(/^file:\/\/(?:localhost)?/, "")).replace(
          /^\/([A-Za-z]:)/,
          "$1",
        );
      if (path.includes("\0")) throw new Error("Invalid source path.");
      const image = [5, 7].includes(Number(resource?.streamType));
      if (!known.has(path)) {
        const id = `med_wfp_${known.size}`;
        known.set(path, id);
        b.media({
          id,
          path,
          kind: image ? "image" : kind === "audio" ? "audio" : "video",
          hasVideo: kind === "video",
          hasAudio: kind === "audio",
          ...(resource?.mediaLength && !image ? { duration: ticks(resource.mediaLength) } : {}),
        });
        b.warnings.push(`Source requires relinking: ${path}`);
      }
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
          : list(parameter.keyframeSets).map((value) => number(object(value)["_value"]));
      if (values.length > 1 && Math.abs(values.at(-1)! - 1) < 0.001) values.pop();
      if (
        speedNode?.reverse ||
        (parameter?.["_freeze"] != null && list(parameter["_freeze"]).length)
      ) {
        b.warnings.push(
          `Unsupported Filmora reverse/freeze clip ${String(c.thisUId ?? sequence)}; clip omitted.`,
        );
        continue;
      }
      const ramp = new Set(values.map((value) => Math.round(value * 1000))).size > 1;
      const start = ticks(c.tlBegin),
        end = ticks(number(c.tlEnd) + 1),
        sourceStart = image ? 0 : number(speedNode?.offset, ticks(c.inPoint ?? 0));
      const speed = speedNode
        ? ramp
          ? (number(speedNode.offsetEnd) - sourceStart) / (end - start)
          : (values[0] ?? 1)
        : number(c.speed, 1);
      if (ramp)
        b.warnings.push(
          `Filmora speed ramp approximated with average speed on ${String(c.thisUId ?? sequence)}.`,
        );
      if (start < 0 || end <= start || sourceStart < 0 || speed <= 0)
        throw new Error("Invalid Filmora clip range or speed.");
      b.clip(trackID, {
        id: `clip_wfp_${sequence++}`,
        content: { media: { mediaID: known.get(path)! } },
        start,
        duration: end - start,
        sourceStart,
        speed,
      });
      for (const key of [
        "effectChainList",
        "pipBuf",
        "preTransition",
        "postTransition",
        "timelineId",
      ])
        if (c[key] != null)
          b.warnings.push(`Unsupported Filmora ${key} on ${String(c.thisUId ?? sequence)}.`);
    }
    b.commands.push({
      updateTrack: {
        trackID,
        patch: { muted: track.mute === true, locked: track.locked === true },
      },
    });
  }
  if (timelines.length > 1) b.warnings.push("Nested timelines require a separate mapping phase.");
  return b.finish("filmora");
}
