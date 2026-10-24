// Ported from TandemCore/ThroughEdits.swift at 735a9b8. See tests/fixtures/tandem/TANDEM-LICENSE.
import type { Clip, Project, Track } from "@sidecut/contracts/project";
import type { EditCommand } from "@sidecut/contracts/commands";
import { flicksPerFrame, Time } from "@sidecut/contracts/time";
import type { EditContext } from "./timeline-editing";
import { end, tracks, requireClip, replace, tidy } from "./timeline-editing";

type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as ObjectValue) : {};
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v != null)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)]),
    );
  return value;
}
const equal = (a: unknown, b: unknown) =>
  JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
function properties(clip: Clip, kind: "video" | "audio") {
  const supplied = clip[kind] ?? {};
  const effects = Array.isArray(supplied.effects)
    ? supplied.effects.map((fx) => ({ enabled: true, params: {}, ...object(fx), id: "" }))
    : [];
  return kind === "audio"
    ? {
        gainDB: 0,
        muted: false,
        normalizeTo: null,
        voiceIsolation: 0,
        ...supplied,
        effects,
        fadeIn: 0,
        fadeOut: 0,
      }
    : {
        opacity: 1,
        cutout: null,
        layoutPreset: null,
        formatOverrides: {},
        ...supplied,
        effects,
        transform: {
          position: { x: 0.5, y: 0.5 },
          scale: 1,
          rotation: 0,
          ...object(supplied.transform),
        },
        crop: { left: 0, top: 0, right: 0, bottom: 0, ...object(supplied.crop) },
      };
}
function shape(clip: Clip) {
  return {
    ...clip,
    id: "",
    name: null,
    start: 0,
    duration: 0,
    sourceStart: 0,
    linkGroup: null,
    keyframes: {},
    tags: [],
    holdEdges: clip.holdEdges ?? false,
    video: properties(clip, "video"),
    audio: properties(clip, "audio"),
  };
}
function mediaID(clip: Clip) {
  return object(clip.content.media).mediaID;
}
function discontinuity(left: Clip, right: Clip, p: Project): string | null {
  if (!mediaID(left) || mediaID(left) !== mediaID(right))
    return "Clips must play the same media file.";
  if (end(left).flicks !== right.start.flicks) return "Clips must meet without a gap or overlap.";
  if (left.freezeFrame || right.freezeFrame) return "A freeze frame cannot be joined.";
  if (left.speed !== right.speed) return "Clips play at different speeds.";
  const delta = right.sourceStart.subtract(
    left.sourceStart.add(left.duration.scaled(left.speed)),
  ).flicks;
  if ((delta < 0n ? -delta : delta) > flicksPerFrame(p.settings.frameRate) / 2n)
    return "The source does not carry straight on at the cut.";
  return null;
}
const fixed = new Set([
  "video.transform.position",
  "video.transform.scale",
  "video.transform.rotation",
  "video.opacity",
  "video.crop.left",
  "video.crop.top",
  "video.crop.right",
  "video.crop.bottom",
  "audio.gainDB",
]);
// Defaults are used only to prove that a one-sided animation stays still across the join.
// They do not enable effect rendering, which has its own later phases.
const effectDefaults: Record<string, Record<string, unknown>> = {
  colorAdjust: Object.fromEntries(
    [
      "exposure",
      "contrast",
      "blackLevel",
      "highlights",
      "shadows",
      "saturation",
      "vibrance",
      "temperature",
      "tint",
    ].map((key) => [key, 0]),
  ),
  hsl: Object.fromEntries(
    ["red", "orange", "yellow", "green", "aqua", "blue", "purple", "magenta"].flatMap((color) =>
      ["Hue", "Saturation", "Luminance"].map((part) => [color + part, 0]),
    ),
  ),
  colorWheels: Object.fromEntries(
    ["shadows", "midtones", "highlights"].flatMap((wheel) =>
      ["Hue", "Amount", "Brightness"].map((part) => [wheel + part, 0]),
    ),
  ),
  vignette: { amount: -30, size: 50, feather: 50 },
  sharpen: { amount: 3 },
  lut: { path: "", intensity: 1 },
  dropShadow: { distance: 4, angle: 135, blur: 5, opacity: 60, color: { r: 0, g: 0, b: 0, a: 1 } },
  border: { width: 4, color: { r: 1, g: 1, b: 1, a: 1 } },
  roundedCorners: { radius: 24 },
  blur: { radius: 20 },
  pixelate: { scale: 24 },
  pitchShift: { semitones: 0 },
  compressor: { threshold: -14, ratio: 3, attack: 10, release: 200, knee: 6, makeup: 0 },
  limiter: { ceiling: -1, release: 100 },
  voiceCleanup: { highPass: 80, expanderThreshold: -40, expanderRange: 10 },
};
function effect(clip: Clip, path: string) {
  const [kind, , id] = path.split(".");
  const props = kind === "video" ? clip.video : kind === "audio" ? clip.audio : null;
  return Array.isArray(props?.effects)
    ? props.effects.map(object).find((fx) => fx.id === id)
    : undefined;
}
function plays(clip: Clip, path: string) {
  return fixed.has(path) || (path.split(".")[1] === "effects" && !!effect(clip, path));
}
function staticValue(clip: Clip, path: string): unknown {
  if (fixed.has(path)) {
    const [kind, ...parts] = path.split(".");
    let value: unknown = properties(clip, kind === "video" ? "video" : "audio");
    for (const part of parts) value = object(value)[part];
    return value;
  }
  const fx = effect(clip, path),
    key = path.split(".").slice(3).join(".");
  return object(fx?.params)[key] ?? effectDefaults[String(fx?.type)]?.[key];
}
type Keys = Clip["keyframes"][string];
function relevant(keys: Keys, from: number, to: number) {
  const result = keys.filter((key) => Number(key.time) >= from && Number(key.time) <= to);
  const before = keys.filter((key) => Number(key.time) < from).at(-1),
    after = keys.find((key) => Number(key.time) > to);
  if (result[0]?.time !== from && before) result.unshift(before);
  if (result.at(-1)?.time !== to && after) result.push(after);
  return result;
}
function mergeKeys(left: Clip, right: Clip): Clip["keyframes"] {
  const own = left.keyframes,
    shifted: Record<string, Keys> = {};
  for (const [path, keys] of Object.entries(right.keyframes)) {
    if (!keys.length) continue;
    const parts = path.split(".");
    let renamed = path;
    if (parts[1] === "effects") {
      const kind = parts[0] === "video" ? "video" : "audio";
      const theirs = Array.isArray(right[kind]?.effects)
        ? (right[kind]!.effects as unknown[]).map(object)
        : [];
      const ours = Array.isArray(left[kind]?.effects)
        ? (left[kind]!.effects as unknown[]).map(object)
        : [];
      const index = theirs.findIndex((fx) => fx.id === parts[2]);
      if (index >= 0 && ours[index]) {
        parts[2] = String(ours[index].id);
        renamed = parts.join(".");
      }
    }
    if (!plays(right, path) && plays(left, renamed))
      throw new Error(`Orphan effect keyframes on ${path} would start playing.`);
    shifted[renamed] = keys.map((key) => ({
      ...key,
      time: Time.fromSeconds(Number(key.time)).add(left.duration).toJSON(),
    }));
  }
  const result: Record<string, Keys> = {};
  for (const path of new Set([...Object.keys(own), ...Object.keys(shifted)])) {
    const a = [...(own[path] ?? [])].sort((x, y) => Number(x.time) - Number(y.time));
    const b = [...(shifted[path] ?? [])].sort((x, y) => Number(x.time) - Number(y.time));
    if (!a.length && !b.length) continue;
    if (!plays(left, path)) {
      result[path] = a.length ? a : b;
      continue;
    }
    if (a.length && b.length) {
      const merged = [...a, ...b.filter((key) => !a.some((other) => equal(key, other)))].sort(
        (x, y) => Number(x.time) - Number(y.time),
      );
      if (
        merged.some((key, i) => i > 0 && key.time === merged[i - 1]?.time) ||
        !equal(relevant(merged, 0, left.duration.seconds), relevant(a, 0, left.duration.seconds)) ||
        !equal(
          relevant(merged, left.duration.seconds, left.duration.seconds + right.duration.seconds),
          relevant(b, left.duration.seconds, left.duration.seconds + right.duration.seconds),
        )
      )
        throw new Error(`The ${path} animations do not carry on at the cut.`);
      result[path] = merged;
    } else {
      const keys = a.length ? a : b,
        value = staticValue(left, path);
      if (
        value === undefined ||
        !relevant(
          keys,
          a.length ? left.duration.seconds : 0,
          a.length ? left.duration.seconds + right.duration.seconds : left.duration.seconds,
        ).every((key) => equal(key.value, value))
      )
        throw new Error(`The ${path} animation would change the other clip.`);
      result[path] = keys;
    }
  }
  return result;
}
function pair(p: Project, track: Track, left: Clip, right: Clip): Clip {
  const reason = discontinuity(left, right, p);
  if (reason) throw new Error(reason);
  if (track.locked) throw new Error(`Track "${track.name}" is locked.`);
  if (
    tracks(p).some((t) => t.transitions.some((transition) => transition.soundClipID === right.id))
  )
    throw new Error("The right clip is a transition sound.");
  for (const transition of track.transitions) {
    if (transition.fromClipID === left.id || transition.toClipID === right.id)
      throw new Error("Remove the transition at the cut before joining.");
    const reach =
      Number(transition.duration) /
      (transition.fromClipID != null && transition.toClipID != null ? 2 : 1);
    if (
      (transition.toClipID === left.id && reach > left.duration.seconds) ||
      (transition.fromClipID === right.id && reach > right.duration.seconds)
    )
      throw new Error("An outer transition would grow across the cut.");
  }
  if (
    Number(left.audio?.fadeOut ?? 0) > 0 ||
    Number(right.audio?.fadeIn ?? 0) > 0 ||
    Number(left.audio?.fadeIn ?? 0) > left.duration.seconds ||
    Number(right.audio?.fadeOut ?? 0) > right.duration.seconds
  )
    throw new Error("An audio fade would change across the cut.");
  if (!equal(shape(left), shape(right)))
    throw new Error("The clips have different playback settings.");
  const joined = tidy({
    ...left,
    duration: left.duration.add(right.duration),
    keyframes: mergeKeys(left, right),
    tags: [...new Set([...left.tags, ...right.tags])],
    ...(left.audio || Number(right.audio?.fadeOut ?? 0) > 0
      ? { audio: { ...left.audio, fadeOut: right.audio?.fadeOut ?? 0 } }
      : {}),
  });
  const item = p.media.find((m) => m.id === mediaID(left));
  if (
    !joined.holdEdges &&
    item?.kind !== "image" &&
    item?.duration &&
    joined.sourceStart.add(joined.duration.scaled(joined.speed)).flicks >
      item.duration.flicks + flicksPerFrame(p.settings.frameRate)
  )
    throw new Error("The joined clip would run past its source.");
  return joined;
}
function join(p: Project, clipID: string): Project {
  const { track, clip: left } = requireClip(p, clipID);
  const right = track.clips[track.clips.indexOf(left) + 1];
  if (!right) throw new Error("There is no next clip to join.");
  const pairs = [{ track, left, right }],
    before: { track: Track; clip: Clip }[] = [],
    after: { track: Track; clip: Clip }[] = [];
  for (const t of tracks(p))
    for (const clip of t.clips) {
      if (clip.id === left.id || clip.id === right.id) continue;
      if (
        left.linkGroup &&
        clip.linkGroup === left.linkGroup &&
        end(clip).flicks === end(left).flicks
      )
        before.push({ track: t, clip });
      else if (
        right.linkGroup &&
        clip.linkGroup === right.linkGroup &&
        clip.start.flicks === right.start.flicks
      )
        after.push({ track: t, clip });
      else if (
        (left.linkGroup && clip.linkGroup === left.linkGroup) ||
        (right.linkGroup && clip.linkGroup === right.linkGroup)
      )
        throw new Error("A linked clip does not meet this cut.");
    }
  for (const member of before) {
    const matches = after.filter((other) => other.track.id === member.track.id);
    if (
      matches.length !== 1 ||
      member.track.clips[member.track.clips.indexOf(member.clip) + 1]?.id !== matches[0]?.clip.id
    )
      throw new Error("Linked clips must pair across the cut on every track.");
    pairs.push({ track: member.track, left: member.clip, right: matches[0]!.clip });
  }
  if (
    after.length !== before.length ||
    new Set(before.map((m) => m.track.id)).size !== before.length
  )
    throw new Error("Linked clips must pair across the cut on every track.");
  // Compute every pair first; a refusal must leave all linked tracks unchanged.
  const planned = pairs.map((entry) => ({
    ...entry,
    joined: pair(p, entry.track, entry.left, entry.right),
  }));
  for (const entry of planned)
    p = replace(p, {
      ...entry.track,
      clips: entry.track.clips.flatMap((c) =>
        c.id === entry.left.id ? [entry.joined] : c.id === entry.right.id ? [] : [c],
      ),
      transitions: entry.track.transitions.map((t) =>
        t.fromClipID === entry.right.id ? { ...t, fromClipID: entry.left.id } : t,
      ),
    });
  return p;
}
export function joinThroughEdits(
  p: Project,
  range: Extract<EditCommand, { joinThroughEdits: unknown }>["joinThroughEdits"]["range"],
) {
  const refused = new Set<string>();
  const joins: {
    time: number;
    pairs: { trackID: string; clipID: string; nextClipID: string }[];
  }[] = [];
  const skipped: {
    time: number;
    trackID: string;
    clipID: string;
    nextClipID: string;
    reason: string;
    message: string;
  }[] = [];
  for (const original of tracks(p)) {
    let index = 0;
    while (true) {
      const track = tracks(p).find((t) => t.id === original.id)!,
        left = track.clips[index],
        right = track.clips[index + 1];
      if (!left || !right) break;
      const cut = end(left);
      if (
        (range &&
          (cut.flicks < range.start.flicks ||
            cut.flicks > range.start.add(range.duration).flicks)) ||
        discontinuity(left, right, p)
      ) {
        index++;
        continue;
      }
      const group =
        left.linkGroup || right.linkGroup
          ? `${left.linkGroup ?? ""}|${right.linkGroup ?? ""}`
          : null;
      if (group && refused.has(group)) {
        index++;
        continue;
      }
      try {
        const next = join(p, left.id);
        const remaining = new Set(tracks(next).flatMap((t) => t.clips.map((c) => c.id)));
        const pairs = tracks(p).flatMap((t) =>
          t.clips.flatMap((c, i) => {
            const following = t.clips[i + 1];
            return following && !remaining.has(following.id)
              ? [{ trackID: t.id, clipID: c.id, nextClipID: following.id }]
              : [];
          }),
        );
        joins.push({ time: cut.seconds, pairs });
        p = next;
      } catch (error) {
        skipped.push({
          time: cut.seconds,
          trackID: track.id,
          clipID: left.id,
          nextClipID: right.id,
          reason: error instanceof Error ? error.message : String(error),
          message: `Didn't join at ${cut.seconds} on "${track.name}" (${left.id}, ${right.id}): ${error instanceof Error ? error.message : String(error)}`,
        });
        if (group) refused.add(group);
        index++;
      }
    }
  }
  return {
    project: p,
    joins: joins.sort((a, b) => a.time - b.time),
    skipped: skipped.sort((a, b) => a.time - b.time),
  };
}
export function editThroughCuts(
  p: Project,
  command: EditCommand,
  context: EditContext,
): Project | null {
  if ("join" in command) return join(p, command.join.clipID);
  if (!("joinThroughEdits" in command)) return null;
  const { project, joins, skipped } = joinThroughEdits(p, command.joinThroughEdits.range);
  if (!joins.length && !skipped.length) context.warn("No through-edits to join.");
  for (const skip of skipped.slice(0, 3)) context.warn(skip.message);
  if (skipped.length > 3)
    context.warn(
      `Didn't join ${skipped.length - 3} more through-edits because their playback would change.`,
    );
  return project;
}
