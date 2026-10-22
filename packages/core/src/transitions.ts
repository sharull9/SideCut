// Ported from TandemCore/Editing.swift, TransitionSounds.swift and TandemRender/Transitions.swift.
// Notice: tests/fixtures/tandem/TANDEM-LICENSE.
import { Schema } from "effect";
import { TransitionSchema } from "@sidecut/contracts/project";
import type { Project, Track, Clip, Transition } from "@sidecut/contracts/project";
import type { EditCommand } from "@sidecut/contracts/commands";
import type { EditContext } from "./timeline-editing";
import { requireTrack, replace, unlocked, end } from "./timeline-editing";
import { Time } from "@sidecut/contracts/time";
import { easing } from "./keyframes";
import { mergePatch } from "./json-merge-patch";
import { patchTransitionSound, checkSoundTie } from "./transition-sounds";

export function transitionWindow(track: Track, t: Record<string, unknown>) {
  const from = track.clips.find((c) => c.id === t.fromClipID),
    to = track.clips.find((c) => c.id === t.toClipID);
  if (typeof t.duration !== "number" || !(t.duration > 0)) return null;
  if (from && to && end(from).flicks !== to.start.flicks) return null;
  const duration = Time.fromSeconds(
    from && to ? t.duration : Math.min(t.duration, (from ?? to)?.duration.seconds ?? t.duration),
  );
  const start =
    from && to
      ? new Time(end(from).flicks - duration.flicks / 2n)
      : to
        ? to.start
        : from
          ? end(from).subtract(duration)
          : null;
  return start
    ? { start: start.seconds, end: start.add(duration).seconds, duration: duration.seconds }
    : null;
}
export function validateTransition(t: Transition, track: Track, ignoring?: string) {
  if (Time.fromSeconds(t.duration).flicks <= 0n)
    throw new Error("Transition duration must be positive.");
  const from = track.clips.find((c) => c.id === t.fromClipID),
    to = track.clips.find((c) => c.id === t.toClipID);
  if ((t.fromClipID != null && !from) || (t.toClipID != null && !to))
    throw new Error("Transition clips must be on its track.");
  if (!from && !to) throw new Error("A transition needs fromClipID, toClipID, or both.");
  const others = track.transitions.filter((other) => other.id !== ignoring);
  if (
    (from && others.some((other) => other.fromClipID === from.id)) ||
    (to && others.some((other) => other.toClipID === to.id))
  )
    throw new Error("This clip edge already has a transition.");
  if (from && to) {
    if (end(from).flicks !== to.start.flicks)
      throw new Error("Transition clips must meet at a cut.");
    const half = Time.fromSeconds(t.duration).flicks / 2n;
    if (half > from.duration.flicks || half > to.duration.flicks)
      throw new Error("The transition is longer than one of its clips.");
  } else if (Time.fromSeconds(t.duration).flicks > (from ?? to)!.duration.flicks)
    throw new Error("The transition is longer than its clip.");
}
export function heldFrameWarnings(p: Project, track: Track, t: Transition): string[] {
  const from = track.clips.find((c) => c.id === t.fromClipID),
    to = track.clips.find((c) => c.id === t.toClipID);
  if (!from || !to) return [];
  const half = Time.fromSeconds(t.duration).scaled(0.5).seconds,
    notes: string[] = [];
  const item = (c: Clip) => {
    const ref = c.content.media;
    return p.media.find(
      (m) => m.id === (ref && typeof ref === "object" && "mediaID" in ref ? ref.mediaID : null),
    );
  };
  const source = item(from);
  if (
    !from.freezeFrame &&
    !from.holdEdges &&
    source?.kind !== "image" &&
    source?.duration &&
    from.sourceStart.seconds + (from.duration.seconds + half) * from.speed > source.duration.seconds
  )
    notes.push(
      `${from.name ?? from.id} has no frames after its end; its last frame holds through the transition handle.`,
    );
  if (
    !to.freezeFrame &&
    !to.holdEdges &&
    item(to) != null &&
    item(to)?.kind !== "image" &&
    half * to.speed > to.sourceStart.seconds
  )
    notes.push(
      `${to.name ?? to.id} has no frames before its start; its first frame holds through the transition handle.`,
    );
  return notes;
}
export function editTransitions(
  p: Project,
  command: EditCommand,
  context: EditContext,
): Project | null {
  if (
    !("addTransition" in command || "updateTransition" in command || "removeTransition" in command)
  )
    return null;
  let track: Track, t: Transition;
  let soundPatch: unknown,
    hasSoundPatch = false,
    oldMiddle: number | null = null;
  if ("addTransition" in command) {
    if (command.addTransition.sound != null) {
      soundPatch = command.addTransition.sound;
      hasSoundPatch = true;
    }
    track = requireTrack(p, command.addTransition.trackID);
    unlocked(track);
    t = Schema.decodeUnknownSync(TransitionSchema)({
      ...command.addTransition.transition,
      id: command.addTransition.transition.id ?? context.makeID("tr"),
    });
    if (
      [
        p.id,
        ...p.media.map((m) => m.id),
        ...p.markers.map((m) => m.id),
        ...[...p.videoTracks, ...p.audioTracks].flatMap((tr) => [
          tr.id,
          ...tr.clips.map((c) => c.id),
          ...tr.transitions.map((value) => value.id),
        ]),
      ].includes(t.id)
    )
      throw new Error(`Duplicate ID ${t.id}.`);
  } else {
    const id =
      "updateTransition" in command
        ? command.updateTransition.transitionID
        : command.removeTransition.transitionID;
    const found = [...p.videoTracks, ...p.audioTracks].find((tr) =>
      tr.transitions.some((value) => value.id === id),
    );
    if (!found) throw new Error(`Transition ${id} not found.`);
    track = found;
    unlocked(track);
    const existing = track.transitions.find((value) => value.id === id)!;
    if ("removeTransition" in command) {
      return replace(p, {
        ...track,
        transitions: track.transitions.filter((value) => value.id !== id),
      });
    }
    if ("id" in command.updateTransition.patch)
      throw new Error("Transition patch cannot change id.");
    const patch = { ...command.updateTransition.patch };
    if ("sound" in patch) {
      soundPatch = patch.sound;
      hasSoundPatch = true;
      delete patch.sound;
    }
    const window = transitionWindow(track, existing);
    oldMiddle = window ? window.start + window.duration / 2 : null;
    t = Schema.decodeUnknownSync(TransitionSchema)(mergePatch(existing, patch));
  }
  validateTransition(t, track, "updateTransition" in command ? t.id : undefined);
  if (t.soundClipID != null) {
    checkSoundTie(p, t.soundClipID, t.id);
    const sound = p.audioTracks.flatMap((tr) => tr.clips).find((c) => c.id === t.soundClipID);
    if (!sound) throw new Error("Transition sound must name an existing audio clip.");
    if (
      [...p.videoTracks, ...p.audioTracks].some((tr) =>
        tr.transitions.some((value) => value.id !== t.id && value.soundClipID === t.soundClipID),
      )
    )
      throw new Error("This audio clip is already tied to a transition.");
  }
  for (const warning of heldFrameWarnings(p, track, t)) context.warn(warning);
  const stored = Schema.decodeUnknownSync(Schema.JsonObject)(
    Schema.encodeSync(TransitionSchema)(t),
  );
  if ("addTransition" in command) context.createdIDs.push(t.id);
  const result = replace(p, {
    ...track,
    transitions:
      "addTransition" in command
        ? [...track.transitions, stored]
        : track.transitions.map((value) => (value.id === t.id ? stored : value)),
  });
  return hasSoundPatch
    ? patchTransitionSound(result, t.id, soundPatch, context, oldMiddle)
    : result;
}
export function transitionProgress(type: string, p: number) {
  p = Math.max(0, Math.min(1, p));
  if (["dissolve", "fadeToBlack", "fadeFromBlack"].includes(type)) return p;
  return type === "cutSlide"
    ? p < 0.5
      ? 8 * p ** 4
      : 1 - (-2 * p + 2) ** 4 / 2
    : easing("easeInOut", p);
}
export const directionVector = (direction: unknown): readonly [number, number] =>
  direction === "right"
    ? [1, 0]
    : direction === "up"
      ? [0, -1]
      : direction === "down"
        ? [0, 1]
        : [-1, 0];
