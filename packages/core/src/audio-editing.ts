// Ported from TandemCore/AudioLevels.swift and Editing.swift. Notice: tests/fixtures/tandem/TANDEM-LICENSE.
import type { Project, Clip, Track, ClipEffect } from "@sidecut/contracts/project";
import type { EditCommand } from "@sidecut/contracts/commands";
import type { EditContext } from "./timeline-editing";
import { normalizeGain } from "./audio-processing";
import { effectsOf } from "./effect-editing";
export function speechMediaID(project: Project, track: Track, clip: Clip): string | null {
  const media = clip.content.media;
  if (
    track.kind !== "audio" ||
    !media ||
    typeof media !== "object" ||
    !("mediaID" in media) ||
    typeof media.mediaID !== "string"
  )
    return null;
  const item = project.media.find((m) => m.id === media.mediaID);
  return track.rippleMode === "cut" || (item && ["camera", "other"].includes(item.role))
    ? media.mediaID
    : null;
}
export function speechLevel(project: Project) {
  const levels = project.audioTracks
    .flatMap((track) =>
      track.clips.flatMap((clip) => {
        const target = clip.audio?.normalizeTo;
        return speechMediaID(project, track, clip) &&
          typeof target === "number" &&
          !clip.audio?.muted
          ? [{ level: target + Number(clip.audio?.gainDB ?? 0), length: clip.duration.seconds }]
          : [];
      }),
    )
    .sort((a, b) => a.level - b.level);
  const total = levels.reduce((sum, item) => sum + item.length, 0);
  if (total <= 0) return project.settings.speechLoudness;
  let running = 0;
  for (const item of levels) {
    running += item.length;
    if (running >= total / 2) return item.level;
  }
  return levels.at(-1)!.level;
}
export function editAudio(
  project: Project,
  command: EditCommand,
  context: EditContext,
): Project | null {
  if (!("normalizeSpeech" in command)) return null;
  const level = project.settings.speechLoudness,
    ceiling = project.settings.truePeakCeiling;
  const measured = command.normalizeSpeech.measured;
  let speech = 0,
    changed = 0,
    animated = 0;
  const held: { clipID: string; peak: number }[] = [];
  const audioTracks = project.audioTracks.map((track) => {
    const clips = track.clips.map((clip) => {
      const mediaID = speechMediaID(project, track, clip);
      if (!mediaID) return clip;
      speech++;
      if (clip.keyframes["audio.gainDB"]?.length) animated++;
      const unlevelled = clip.audio?.normalizeTo !== level || Number(clip.audio?.gainDB ?? 0) !== 0;
      if (track.locked) {
        if (unlevelled) context.warn(`Locked track "${track.name}" was left as it was.`);
        return clip;
      }
      let audio: NonNullable<Clip["audio"]> = { ...clip.audio, normalizeTo: level, gainDB: 0 };
      if (unlevelled) changed++;
      const sound = measured?.[mediaID],
        effects = [...effectsOf(clip, "audio")];
      const peak = sound
        ? sound.truePeakDBTP + normalizeGain(level, sound.integratedLUFS)
        : -Infinity;
      if (
        !track.muted &&
        !audio.muted &&
        peak > ceiling &&
        !effects.some((fx) => fx.type === "limiter")
      ) {
        const add = (type: string, params: ClipEffect["params"]) => {
          const id = context.makeID("fx");
          context.createdIDs.push(id);
          effects.push({ id, type, enabled: true, params });
        };
        if (!effects.some((fx) => fx.type === "compressor"))
          add("compressor", { threshold: level + 6, ratio: 3 });
        add("limiter", { ceiling });
        audio = { ...audio, effects: effects as unknown as NonNullable<Clip["audio"]>[string] };
        held.push({ clipID: clip.id, peak });
      }
      return unlevelled || audio.effects ? { ...clip, audio } : clip;
    });
    return { ...track, clips };
  });
  if (!speech)
    context.warn(
      "There are no speech clips to normalise: camera or voice sound, or clips on a take track like Voice.",
    );
  else if (!changed && !held.length)
    context.warn(`Every speech clip is already at ${level} LUFS with no gain.`);
  if (held.length) {
    const peak = Math.max(...held.map((h) => h.peak));
    context.warn(
      `Levelled to ${level} LUFS, ${held.length} speech clip${held.length === 1 ? "" : "s"} would peak at ${peak >= 0 ? "+" : ""}${peak.toFixed(1)} dBTP, over the ${ceiling} dBTP ceiling. Added peak protection to ${held.map((h) => h.clipID).join(", ")}.`,
    );
  }
  if (animated)
    context.warn(
      `${animated} speech clip${animated === 1 ? " keeps its" : "s keep their"} gain animation, which plays on top of the level.`,
    );
  return { ...project, audioTracks };
}
