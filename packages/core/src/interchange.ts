import { safeArchivePath } from "./archive";
import { builder, object, list, number, text, type ObjectValue } from "./import-builder";
export { object } from "./import-builder";
export type { ImportReport } from "./import-builder";
export { importFilmora } from "./filmora";

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
