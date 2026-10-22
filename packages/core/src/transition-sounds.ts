// Ported from TandemCore/TransitionSounds.swift. Notice: tests/fixtures/tandem/TANDEM-LICENSE.
import { Schema } from "effect";
import { ClipSchema, TrackSchema } from "@sidecut/contracts/project";
import type { Project, Clip, Track } from "@sidecut/contracts/project";
import type { EditCommand } from "@sidecut/contracts/commands";
import { Time } from "@sidecut/contracts/time";
import { transitionWindow } from "./transitions";
import { tracks, replace, end, tidy } from "./timeline-editing";
import type { EditContext } from "./timeline-editing";
const locate = (p: Project, id: string) => {
  for (const track of tracks(p)) {
    const clip = track.clips.find((c) => c.id === id);
    if (clip) return { track, clip };
  }
  return null;
};
const middle = (track: Track, t: Track["transitions"][number]) => {
  const w = transitionWindow(track, t);
  return w ? w.start + w.duration / 2 : null;
};
const allTransitions = (p: Project) =>
  tracks(p).flatMap((track) => track.transitions.map((transition) => ({ track, transition })));
const untie = (p: Project, id: string) => ({
  ...p,
  videoTracks: p.videoTracks.map((t) => ({
    ...t,
    transitions: t.transitions.map((tr) => (tr.id === id ? { ...tr, soundClipID: null } : tr)),
  })),
  audioTracks: p.audioTracks.map((t) => ({
    ...t,
    transitions: t.transitions.map((tr) => (tr.id === id ? { ...tr, soundClipID: null } : tr)),
  })),
});
function removeSound(p: Project, id: string, context: EditContext, requireUnlocked = false) {
  const found = locate(p, id);
  if (!found) return p;
  if (found.track.locked) {
    if (requireUnlocked) throw new Error(`Track "${found.track.name}" is locked.`);
    context.warn(
      `The sound of a removed transition stays on "${found.track.name}": the track is locked.`,
    );
    return p;
  }
  return replace(p, { ...found.track, clips: found.track.clips.filter((c) => c.id !== id) });
}
function placeSound(
  p: Project,
  sound: Clip,
  preferred: string | undefined,
  context: EditContext,
): { project: Project; placed: boolean } {
  const current = locate(p, sound.id);
  if (current?.track.locked) {
    context.warn(
      `A transition's sound on "${current.track.name}" didn't move with it: the track is locked.`,
    );
    return { project: p, placed: true };
  }
  if (current) p = removeSound(p, sound.id, context);
  if (sound.start.seconds < 0) {
    if (end(sound).seconds <= 0) return { project: p, placed: false };
    const removed = -sound.start.seconds;
    sound = tidy({
      ...sound,
      start: Time.fromSeconds(0),
      duration: Time.fromSeconds(sound.duration.seconds - removed),
      sourceStart: Time.fromSeconds(sound.sourceStart.seconds + removed * sound.speed),
      keyframes: Object.fromEntries(
        Object.entries(sound.keyframes).map(([key, list]) => [
          key,
          list.map((frame) => ({ ...frame, time: Number(frame.time) - removed })),
        ]),
      ),
    });
  }
  const free = (t: Track) =>
    !t.locked &&
    t.clips.every(
      (c) => c.start.flicks >= end(sound).flicks || end(c).flicks <= sound.start.flicks,
    );
  let track =
    p.audioTracks.find((t) => t.id === preferred && free(t)) ??
    p.audioTracks.find((t) => /^sfx(?: \d+)?$/i.test(t.name) && free(t));
  if (!track) {
    let number = 1;
    while (
      p.audioTracks.some((t) => t.name.toLowerCase() === (number === 1 ? "sfx" : `sfx ${number}`))
    )
      number++;
    track = Schema.decodeUnknownSync(TrackSchema)({
      id: context.makeID("trk"),
      kind: "audio",
      name: number === 1 ? "SFX" : `SFX ${number}`,
      rippleMode: "follow",
    });
    context.createdIDs.push(track.id);
    p = { ...p, audioTracks: [...p.audioTracks, track] };
  }
  return {
    project: replace(p, {
      ...track,
      clips: [...track.clips, sound].sort((a, b) => a.start.seconds - b.start.seconds),
    }),
    placed: true,
  };
}
export function checkSoundTie(p: Project, id: string, transitionID: string) {
  const sound = locate(p, id);
  if (!sound || sound.track.kind !== "audio")
    throw new Error("Transition sound must name an existing audio clip.");
  if (sound.track.transitions.some((t) => t.fromClipID === id || t.toClipID === id))
    throw new Error("A transition sound cannot be in a transition on its own track.");
  if (
    allTransitions(p).some(
      ({ transition }) => transition.id !== transitionID && transition.soundClipID === id,
    )
  )
    throw new Error("This audio clip is already tied to a transition.");
}
export function patchTransitionSound(
  p: Project,
  id: string,
  patch: unknown,
  context: EditContext,
  oldMiddle?: number | null,
): Project {
  const found = allTransitions(p).find(({ transition }) => transition.id === id)!;
  const current =
    typeof found.transition.soundClipID === "string"
      ? locate(p, found.transition.soundClipID)
      : null;
  if (patch === null)
    return untie(current ? removeSound(p, current.clip.id, context, true) : p, id);
  if (!patch || typeof patch !== "object" || Array.isArray(patch))
    throw new Error("A transition's sound must be an object or null.");
  const fields = patch as Record<string, unknown>;
  if (Object.keys(fields).some((key) => !["mediaID", "gainDB", "offset"].includes(key)))
    throw new Error("Transition sound accepts mediaID, gainDB, and offset.");
  for (const key of ["gainDB", "offset"])
    if (fields[key] != null && (typeof fields[key] !== "number" || !Number.isFinite(fields[key])))
      throw new Error(`Sound ${key} must be finite.`);
  if (fields.mediaID != null && typeof fields.mediaID !== "string")
    throw new Error("Sound mediaID must be a string.");
  if (current?.track.locked) throw new Error(`Track "${current.track.name}" is locked.`);
  const center = middle(found.track, found.transition),
    window = transitionWindow(found.track, found.transition);
  if (center == null || !window) throw new Error("The transition's sound has nowhere to go.");
  let clip = current?.clip;
  const mediaID = fields.mediaID;
  if (
    !clip ||
    (typeof mediaID === "string" &&
      clip.content.media &&
      typeof clip.content.media === "object" &&
      "mediaID" in clip.content.media &&
      clip.content.media.mediaID !== mediaID)
  ) {
    const item = p.media.find((m) => m.id === mediaID);
    if (!item?.hasAudio) throw new Error("Transition sound needs media with audio.");
    clip = Schema.decodeUnknownSync(ClipSchema)({
      ...clip,
      id: clip?.id ?? context.makeID("clip"),
      content: { media: { mediaID: item.id } },
      start: clip?.start.toJSON() ?? window.start,
      duration: item.duration?.seconds && item.duration.seconds > 0 ? item.duration.seconds : 1,
      sourceStart: 0,
      speed: 1,
      freezeFrame: false,
      keyframes: {},
      audio: clip?.audio ?? { gainDB: -15 },
    });
    if (!current) context.createdIDs.push(clip.id);
  }
  if (typeof fields.gainDB === "number")
    clip = { ...clip, audio: { ...clip.audio, gainDB: fields.gainDB } };
  clip = {
    ...clip,
    start: Time.fromSeconds(
      typeof fields.offset === "number"
        ? center + fields.offset
        : clip.start.seconds + (oldMiddle == null ? 0 : center - oldMiddle),
    ),
  };
  const placed = placeSound(p, clip, current?.track.id, context);
  if (!placed.placed)
    throw new Error("The sound would end before the timeline starts; give it a later offset.");
  context.placedSounds.add(clip.id);
  return replace(placed.project, {
    ...found.track,
    transitions: found.track.transitions.map((t) =>
      t.id === id ? { ...t, soundClipID: clip!.id } : t,
    ),
    // An audio transition can share the track used for an existing sound only after tie validation.
    clips:
      placed.project.audioTracks.find((t) => t.id === found.track.id)?.clips ?? found.track.clips,
  });
}
function namedClips(command: EditCommand) {
  const body = Object.values(command)[0] as Record<string, unknown>;
  if ("clipIDs" in body && Array.isArray(body.clipIDs)) return new Set(body.clipIDs as string[]);
  if (typeof body.clipID === "string") return new Set([body.clipID]);
  if ("roll" in command) return new Set([command.roll.leftClipID, command.roll.rightClipID]);
  return new Set<string>();
}
export function reconcileTransitionSounds(
  before: Project,
  after: Project,
  command: EditCommand,
  context: EditContext,
  createdFrom: number,
): Project {
  const anchors = allTransitions(before)
    .filter(({ transition }) => typeof transition.soundClipID === "string")
    .map(({ track, transition }) => ({
      id: String(transition.id),
      middle: middle(track, transition),
      sound: locate(before, String(transition.soundClipID)),
    }));
  const named = namedClips(command);
  let p = after;
  const removePieces = (id: string) => {
    for (const made of context.createdIDs.slice(createdFrom)) {
      let origin = context.cutFrom.get(made);
      while (origin && origin !== id) origin = context.cutFrom.get(origin);
      if (origin === id && made !== id) p = removeSound(p, made, context);
    }
  };
  for (const anchor of anchors) {
    const found = allTransitions(p).find(({ transition }) => transition.id === anchor.id);
    if (
      !found &&
      anchor.sound &&
      !allTransitions(p).some(({ transition }) => transition.soundClipID === anchor.sound!.clip.id)
    ) {
      removePieces(anchor.sound.clip.id);
      p = removeSound(p, anchor.sound.clip.id, context);
      continue;
    }
    if (
      !found ||
      !anchor.sound ||
      found.transition.soundClipID !== anchor.sound.clip.id ||
      context.placedSounds.has(anchor.sound.clip.id)
    )
      continue;
    const present = locate(p, anchor.sound.clip.id),
      center = middle(found.track, found.transition);
    if (
      named.has(anchor.sound.clip.id) ||
      anchor.middle == null ||
      center == null ||
      center === anchor.middle
    ) {
      if (!present) p = untie(p, anchor.id);
      continue;
    }
    removePieces(anchor.sound.clip.id);
    const placed = placeSound(
      p,
      {
        ...anchor.sound.clip,
        start: Time.fromSeconds(anchor.sound.clip.start.seconds + center - anchor.middle),
      },
      present?.track.id ?? anchor.sound.track.id,
      context,
    );
    p = placed.placed ? placed.project : untie(placed.project, anchor.id);
  }
  return p;
}
