// Behavior ported from TandemCore/Editing.swift and TrackEditing.swift at the pinned revision.
// Upstream notice: tests/fixtures/tandem/TANDEM-LICENSE.
import type { Project, Track, Clip } from "@sidecut/contracts/project";
import type { EditCommand } from "@sidecut/contracts/commands";
import { Time, FLICKS_PER_SECOND } from "@sidecut/contracts/time";

const tracks = (p: Project) => [...p.videoTracks, ...p.audioTracks];
const end = (clip: Clip) => clip.start.add(clip.duration);
const overlaps = (clip: Clip, a: Time, b: Time) =>
  clip.start.flicks < b.flicks && end(clip).flicks > a.flicks;
const zero = new Time(0n);
const max = (a: Time, b: Time) => (a.flicks > b.flicks ? a : b);

export class EditContext {
  private state: bigint;
  readonly cutFrom = new Map<string, string>();
  private groups = new Map<string, string>();
  constructor(
    seed: bigint,
    readonly createdIDs: string[],
    readonly warnings: string[],
  ) {
    this.state = BigInt.asUintN(64, seed);
  }
  private next() {
    this.state = BigInt.asUintN(64, this.state + 0x9e3779b97f4a7c15n);
    let z = this.state;
    z = BigInt.asUintN(64, (z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n);
    z = BigInt.asUintN(64, (z ^ (z >> 27n)) * 0x94d049bb133111ebn);
    return z ^ (z >> 31n);
  }
  makeID(prefix: string) {
    const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
    let id = `${prefix}_`;
    for (let i = 0; i < 8; i++) id += alphabet[Number(this.next() % BigInt(alphabet.length))];
    return id;
  }
  group(group: string, at: Time) {
    const key = `${group}@${at.flicks}`;
    let id = this.groups.get(key);
    if (!id) {
      id = this.makeID("lnk");
      this.groups.set(key, id);
    }
    return id;
  }
  warn(message: string) {
    if (!this.warnings.includes(message)) this.warnings.push(message);
  }
}

export function batchSeed(id: string, revision: number, key: string | null | undefined): bigint {
  let hash = 14695981039346656037n;
  for (const char of `${id}:${revision}:${key ?? ""}`)
    hash = BigInt.asUintN(64, (hash ^ BigInt(char.codePointAt(0)!)) * 1099511628211n);
  return hash;
}
function requireTrack(p: Project, id: string): Track {
  const exact = tracks(p).find((t) => t.id === id);
  if (exact) return exact;
  const found = tracks(p).filter((t) => t.name.toLowerCase() === id.toLowerCase());
  if (found.length > 1) throw new Error(`Multiple tracks named "${id}"; use IDs.`);
  if (!found[0]) throw new Error(`Track ${id} not found.`);
  return found[0];
}
function requireClip(p: Project, id: string) {
  for (const track of tracks(p)) {
    const clip = track.clips.find((c) => c.id === id);
    if (clip) return { track, clip };
  }
  throw new Error(`Clip ${id} not found.`);
}
function unlocked(track: Track) {
  if (track.locked) throw new Error(`Track "${track.name}" is locked.`);
}
export function linkedIDs(p: Project, ids: readonly string[], include = true): string[] {
  const result = new Set<string>();
  for (const id of ids) {
    const { clip } = requireClip(p, id);
    for (const member of include && clip.linkGroup
      ? tracks(p)
          .flatMap((t) => t.clips)
          .filter((c) => c.linkGroup === clip.linkGroup)
      : [clip])
      result.add(member.id);
  }
  return [...result];
}
function tidy(clip: Clip): Clip {
  const audio = clip.audio ? { ...clip.audio } : clip.audio;
  if (audio)
    for (const key of ["fadeIn", "fadeOut"]) {
      const value = audio[key];
      if (typeof value === "number") audio[key] = Math.min(value, clip.duration.seconds);
    }
  const keyframes: Record<string, Clip["keyframes"][string]> = {};
  for (const [path, list] of Object.entries(clip.keyframes)) {
    const ordered = [...list].sort((a, b) => Number(a.time) - Number(b.time));
    const before = ordered.filter((k) => Number(k.time) < 0).at(-1),
      after = ordered.find((k) => Number(k.time) > clip.duration.seconds);
    const kept = ordered.filter(
      (k) => Number(k.time) >= 0 && Number(k.time) <= clip.duration.seconds,
    );
    if (before) kept.unshift(before);
    if (after) kept.push(after);
    if (kept.length) keyframes[path] = kept;
  }
  return audio ? { ...clip, audio, keyframes } : { ...clip, keyframes };
}
function head(clip: Clip, to: Time): Clip {
  const delta = to.subtract(clip.start);
  const keyframes = Object.fromEntries(
    Object.entries(clip.keyframes).map(([path, list]) => [
      path,
      list.map((k) => ({ ...k, time: Time.fromSeconds(Number(k.time)).subtract(delta).toJSON() })),
    ]),
  );
  return tidy({
    ...clip,
    start: to,
    duration: clip.duration.subtract(delta),
    sourceStart: clip.freezeFrame
      ? clip.sourceStart
      : clip.sourceStart.add(delta.scaled(clip.speed)),
    keyframes,
  });
}
function tail(clip: Clip, to: Time) {
  return tidy({ ...clip, duration: to.subtract(clip.start) });
}
function split(clip: Clip, at: Time, context: EditContext) {
  const id = context.makeID("clip");
  context.createdIDs.push(id);
  context.cutFrom.set(id, clip.id);
  let left: Clip = tail(clip, at),
    right: Clip = {
      ...head(clip, at),
      id,
      linkGroup: clip.linkGroup ? context.group(clip.linkGroup, at) : (clip.linkGroup ?? null),
    };
  if (left.audio) left = { ...left, audio: { ...left.audio, fadeOut: 0 } };
  if (right.audio) right = { ...right, audio: { ...right.audio, fadeIn: 0 } };
  for (const side of ["left", "right"] as const) {
    const target = side === "left" ? left : right;
    const text = target.content.text;
    if (text && typeof text === "object" && "text" in text && typeof text.text === "string") {
      const fields: Record<string, unknown> & { text: string } = { ...text, text: text.text };
      const key = side === "left" ? "animationOut" : "animationIn";
      if ("preset" in fields && fields.preset != null) fields[key] = "none";
      else delete fields[key];
      if (side === "left") left = { ...left, content: { text: fields } };
      else right = { ...right, content: { text: fields } };
    }
  }
  return { left, right };
}
function transitionTouches(t: Record<string, unknown>, ids: Set<string>) {
  return ids.has(String(t.fromClipID)) || ids.has(String(t.toClipID));
}
function guardSounds(track: Track) {
  if (track.transitions.some((t) => t.sound != null))
    throw new Error(
      "Editing transition sounds is not implemented yet. Remove their transitions before editing this track.",
    );
}
function repair(track: Track, context: EditContext): Track {
  const transitions = track.transitions.filter((t) => {
    const from = t.fromClipID == null ? null : track.clips.find((c) => c.id === t.fromClipID),
      to = t.toClipID == null ? null : track.clips.find((c) => c.id === t.toClipID);
    if ((t.fromClipID != null && !from) || (t.toClipID != null && !to)) return false;
    if (from && to && end(from).flicks !== to.start.flicks) {
      context.warn(`Removed a ${t.type} transition on ${track.name}: its clips no longer meet.`);
      return false;
    }
    return true;
  });
  return { ...track, transitions };
}
export function normalizeLinks(p: Project): Project {
  const counts = new Map<string, number>();
  for (const clip of tracks(p).flatMap((t) => t.clips))
    if (clip.linkGroup) counts.set(clip.linkGroup, (counts.get(clip.linkGroup) ?? 0) + 1);
  const clean = (list: readonly Track[]) =>
    list.map((track) => ({
      ...track,
      clips: track.clips.map((clip) =>
        clip.linkGroup && counts.get(clip.linkGroup) === 1 ? { ...clip, linkGroup: null } : clip,
      ),
    }));
  return { ...p, videoTracks: clean(p.videoTracks), audioTracks: clean(p.audioTracks) };
}
function sorted(track: Track): Track {
  return {
    ...track,
    clips: [...track.clips].sort((a, b) =>
      a.start.flicks < b.start.flicks ? -1 : a.start.flicks > b.start.flicks ? 1 : 0,
    ),
  };
}
function replace(p: Project, track: Track): Project {
  return {
    ...p,
    videoTracks: p.videoTracks.map((t) => (t.id === track.id ? track : t)),
    audioTracks: p.audioTracks.map((t) => (t.id === track.id ? track : t)),
  };
}
function clearRange(track: Track, a: Time, b: Time, context: EditContext): Track {
  const clips: Clip[] = [];
  let transitions = [...track.transitions];
  const removed = new Set<string>();
  for (const clip of track.clips) {
    if (!overlaps(clip, a, b)) {
      clips.push(clip);
      continue;
    }
    const hasLeft = clip.start.flicks < a.flicks,
      hasRight = end(clip).flicks > b.flicks;
    if (hasLeft) {
      let left = tail(clip, a);
      if (hasRight && left.audio) left = { ...left, audio: { ...left.audio, fadeOut: 0 } };
      clips.push(left);
    }
    if (hasRight) {
      let right = head(clip, b);
      if (hasLeft) {
        const id = context.makeID("clip");
        context.createdIDs.push(id);
        context.cutFrom.set(id, clip.id);
        right = { ...right, id };
        if (right.audio) right = { ...right, audio: { ...right.audio, fadeIn: 0 } };
        transitions = transitions.map((t) =>
          t.fromClipID === clip.id ? { ...t, fromClipID: id } : t,
        );
      }
      if (clip.linkGroup) right = { ...right, linkGroup: context.group(clip.linkGroup, b) };
      clips.push(right);
    }
    if (!hasLeft && !hasRight) removed.add(clip.id);
  }
  return {
    ...track,
    clips,
    transitions: transitions.filter((t) => !transitionTouches(t, removed)),
  };
}
function removeRange(
  p: Project,
  a: Time,
  b: Time,
  cut: Set<string>,
  context: EditContext,
): Project {
  if (a.flicks < 0n || b.flicks <= a.flicks)
    throw new Error("The deletion range must start at or after zero and have positive duration.");
  const global = tracks(p).some((t) => cut.has(t.id) && t.rippleMode === "cut"),
    duration = b.subtract(a);
  const map = (time: Time) =>
    time.flicks <= a.flicks ? time : time.flicks < b.flicks ? a : time.subtract(duration);
  for (const original of tracks(p)) {
    const action = cut.has(original.id)
      ? "cut"
      : global && original.rippleMode !== "off"
        ? original.rippleMode
        : null;
    if (!action) continue;
    if (original.locked) {
      if (original.clips.some((c) => end(c).flicks > a.flicks))
        context.warn(`Locked track "${original.name}" didn't move with the edit.`);
      continue;
    }
    guardSounds(original);
    let track: Track;
    if (action === "cut") {
      const cleared = clearRange(original, a, b, context);
      track = {
        ...cleared,
        clips: cleared.clips.map((c) =>
          c.start.flicks >= b.flicks ? { ...c, start: c.start.subtract(duration) } : c,
        ),
      };
    } else {
      const clips: Clip[] = [];
      for (const clip of original.clips) {
        const start = map(clip.start),
          finish = map(end(clip));
        if (finish.flicks <= start.flicks) {
          context.warn(
            `Removed ${clip.name ?? clip.id} from ${original.name}: it sat entirely inside the deleted time.`,
          );
          continue;
        }
        clips.push(
          start.flicks !== clip.start.flicks || finish.flicks !== end(clip).flicks
            ? tail({ ...clip, start }, finish)
            : clip,
        );
      }
      track = { ...original, clips };
    }
    p = replace(p, repair(sorted(track), context));
  }
  if (global)
    p = {
      ...p,
      markers: p.markers
        .map((marker) => {
          if (typeof marker.time !== "number") throw new Error("Marker time is invalid.");
          const start = map(Time.fromSeconds(marker.time)),
            finish = map(Time.fromSeconds(marker.time + Number(marker.duration ?? 0)));
          return { ...marker, time: start.toJSON(), duration: finish.subtract(start).toJSON() };
        })
        .sort((x, y) => Number(x.time) - Number(y.time)),
    };
  return p;
}
function union(ranges: { a: Time; b: Time }[]) {
  const result: { a: Time; b: Time }[] = [];
  for (const range of ranges.sort((x, y) => (x.a.flicks < y.a.flicks ? -1 : 1))) {
    const last = result.at(-1);
    if (last && range.a.flicks <= last.b.flicks) last.b = max(last.b, range.b);
    else result.push({ ...range });
  }
  return result;
}

export function editTimeline(
  p: Project,
  command: EditCommand,
  context: EditContext,
): Project | null {
  if ("blade" in command) {
    const { at, clipIDs, trackIDs } = command.blade;
    let ids: string[] = [];
    if (clipIDs != null) {
      for (const id of clipIDs) {
        const family = tracks(p)
          .flatMap((t) => t.clips)
          .filter((c) => {
            let current = c.id;
            for (let i = 0; i < 10000; i++) {
              if (current === id) return true;
              const from = context.cutFrom.get(current);
              if (!from) return false;
              current = from;
            }
            return false;
          });
        if (!family.length) throw new Error(`Clip ${id} not found.`);
        const piece = family.find((c) => c.start.flicks < at.flicks && at.flicks < end(c).flicks);
        if (piece) ids.push(piece.id);
        else if (!family.some((c) => c.start.flicks === at.flicks || end(c).flicks === at.flicks))
          throw new Error(`Clip ${id} has no piece at this cut time.`);
      }
    } else
      for (const track of trackIDs != null
        ? trackIDs.map((id) => requireTrack(p, id))
        : tracks(p).filter((t) => t.targeted)) {
        const clip = track.clips.find(
          (c) => c.start.flicks <= at.flicks && at.flicks < end(c).flicks,
        );
        if (clip) ids.push(clip.id);
      }
    ids = linkedIDs(p, ids);
    let count = 0;
    for (const id of ids) {
      const { track, clip } = requireClip(p, id);
      if (!(clip.start.flicks < at.flicks && at.flicks < end(clip).flicks)) continue;
      if (track.locked) {
        context.warn(`Didn't cut "${track.name}": the track is locked.`);
        continue;
      }
      guardSounds(track);
      const { left, right } = split(clip, at, context);
      p = replace(p, {
        ...track,
        clips: track.clips.flatMap((c) => (c.id === id ? [left, right] : [c])),
        transitions: track.transitions.map((t) =>
          t.fromClipID === id ? { ...t, fromClipID: right.id } : t,
        ),
      });
      count++;
    }
    if (!count) context.warn(`Nothing to cut at ${at.seconds}.`);
    return normalizeLinks(p);
  }
  if ("trim" in command) {
    const { clipID, edge, to, ripple, includeLinked } = command.trim;
    if (ripple) throw new Error("Ripple trim is not implemented yet.");
    const primary = requireClip(p, clipID).clip;
    const delta = to.subtract(edge === "start" ? primary.start : end(primary));
    if (delta.flicks === 0n) return p;
    for (const id of linkedIDs(p, [clipID], includeLinked ?? true)) {
      const { track, clip } = requireClip(p, id);
      unlocked(track);
      guardSounds(track);
      const next =
        edge === "start" ? head(clip, clip.start.add(delta)) : tail(clip, end(clip).add(delta));
      if (next.start.flicks < 0n || next.duration.flicks <= 0n)
        throw new Error("That trim would leave a clip before zero or without duration.");
      p = replace(p, sorted({ ...track, clips: track.clips.map((c) => (c.id === id ? next : c)) }));
    }
    return p;
  }
  if ("link" in command || "unlink" in command) {
    const ids =
      "link" in command
        ? linkedIDs(p, command.link.clipIDs)
        : linkedIDs(p, command.unlink.clipIDs, false);
    if ("link" in command && ids.length < 2) throw new Error("Link needs at least two clips.");
    const group = "link" in command ? context.makeID("lnk") : null;
    for (const track of tracks(p))
      p = replace(p, {
        ...track,
        clips: track.clips.map((c) => (ids.includes(c.id) ? { ...c, linkGroup: group } : c)),
      });
    return normalizeLinks(p);
  }
  if ("removeClips" in command) {
    const { clipIDs, ripple, includeLinked } = command.removeClips,
      ids = new Set(linkedIDs(p, clipIDs, includeLinked ?? true));
    if (!ids.size) return p;
    const ranges: { a: Time; b: Time }[] = [],
      touched = new Set<string>();
    for (const id of ids) {
      const { track, clip } = requireClip(p, id);
      unlocked(track);
      guardSounds(track);
      ranges.push({ a: clip.start, b: end(clip) });
      touched.add(track.id);
    }
    for (const track of tracks(p))
      if (touched.has(track.id))
        p = replace(p, {
          ...track,
          clips: track.clips.filter((c) => !ids.has(c.id)),
          transitions: track.transitions.filter((t) => !transitionTouches(t, ids)),
        });
    if (ripple) {
      const rangesToRemove = union(ranges);
      for (const track of tracks(p).filter((t) => touched.has(t.id)))
        for (const range of rangesToRemove)
          if (track.clips.some((c) => overlaps(c, range.a, range.b)))
            throw new Error(
              `Ripple delete needs selected clips to line up on "${track.name}". Lift instead or delete a time range.`,
            );
      for (const range of rangesToRemove.reverse())
        p = removeRange(p, range.a, range.b, touched, context);
    }
    return normalizeLinks(p);
  }
  if ("rippleDeleteRange" in command) {
    const { range, trackIDs } = command.rippleDeleteRange;
    let cut: Set<string>;
    if (trackIDs != null) cut = new Set(trackIDs.map((id) => requireTrack(p, id).id));
    else {
      const list = tracks(p).filter((t) => t.rippleMode === "cut");
      cut = new Set(
        (list.length ? list : tracks(p).filter((t) => t.rippleMode !== "off")).map((t) => t.id),
      );
    }
    return normalizeLinks(
      removeRange(p, range.start, range.start.add(range.duration), cut, context),
    );
  }
  if ("moveClips" in command) {
    const body = command.moveClips;
    if (body.mode != null && body.mode !== "place")
      throw new Error("Overwrite moves are not implemented yet.");
    const ids = linkedIDs(p, body.clipIDs, body.includeLinked ?? true),
      selected = new Set(ids),
      destination = body.toTrackID != null ? requireTrack(p, body.toTrackID) : null;
    if (destination && new Set(body.clipIDs.map((id) => requireClip(p, id).track.id)).size !== 1)
      throw new Error("To move to another track, select clips from one source track.");
    const moved = ids.map((id) => {
      const { track, clip } = requireClip(p, id);
      unlocked(track);
      guardSounds(track);
      const target = destination && body.clipIDs.includes(id) ? destination : track;
      unlocked(target);
      guardSounds(target);
      const next = { ...clip, start: clip.start.add(body.delta ?? zero) };
      if (next.start.flicks < 0n) throw new Error("Clips cannot move before zero.");
      return { clip: next, target };
    });
    const carried: { transition: Track["transitions"][number]; target: string }[] = [];
    for (const track of tracks(p)) {
      for (const transition of track.transitions) {
        if (!transitionTouches(transition, selected)) continue;
        const owners = [transition.fromClipID, transition.toClipID].filter(
          (id): id is string => typeof id === "string",
        );
        const targets = owners.map((id) => moved.find((m) => m.clip.id === id)?.target.id);
        if (targets.every((id) => id != null && id === targets[0]))
          carried.push({ transition, target: targets[0]! });
        else context.warn(`Removed a ${transition.type} transition: its clips were moved apart.`);
      }
      p = replace(p, {
        ...track,
        clips: track.clips.filter((c) => !selected.has(c.id)),
        transitions: track.transitions.filter((t) => !transitionTouches(t, selected)),
      });
    }
    for (const move of moved) {
      const track = requireTrack(p, move.target.id);
      p = replace(p, sorted({ ...track, clips: [...track.clips, move.clip] }));
    }
    for (const carry of carried) {
      const track = requireTrack(p, carry.target);
      p = replace(p, { ...track, transitions: [...track.transitions, carry.transition] });
    }
    for (const original of tracks(p)) {
      let previous = zero;
      const clips = original.clips.map((clip) => {
        let next = clip;
        if (
          clip.start.flicks < previous.flicks &&
          previous.flicks - clip.start.flicks < FLICKS_PER_SECOND / 1000n &&
          end(clip).flicks > previous.flicks
        )
          next = head(clip, previous);
        previous = max(previous, end(next));
        return next;
      });
      p = replace(p, repair({ ...original, clips }, context));
    }
    return p;
  }
  return null;
}
