// Audio scheduling from TandemRender/RenderPlan.swift. Notice: tests/fixtures/tandem/TANDEM-LICENSE.
import type { Project, Track } from "@sidecut/contracts/project";
import type { Clip } from "@sidecut/contracts/project";
import { effectsOf } from "./effect-editing";
import { transitionWindow } from "./transitions";

export function seamlessAudio(a: Clip, b: Clip) {
  const mediaID = (c: Clip) =>
    c.content.media && typeof c.content.media === "object" && "mediaID" in c.content.media
      ? c.content.media.mediaID
      : null;
  const effects = (c: Clip) =>
    effectsOf(c, "audio").map(({ type, enabled, params }) => ({ type, enabled, params }));
  return (
    a.enabled &&
    b.enabled &&
    !a.audio?.muted &&
    !b.audio?.muted &&
    a.start.flicks + a.duration.flicks === b.start.flicks &&
    mediaID(a) != null &&
    mediaID(a) === mediaID(b) &&
    a.speed === b.speed &&
    !a.freezeFrame &&
    !b.freezeFrame &&
    Math.abs(a.sourceStart.seconds + a.duration.seconds * a.speed - b.sourceStart.seconds) <=
      1 / 48000 &&
    Number(a.audio?.gainDB ?? 0) === Number(b.audio?.gainDB ?? 0) &&
    (a.audio?.normalizeTo ?? null) === (b.audio?.normalizeTo ?? null) &&
    Number(a.audio?.voiceIsolation ?? 0) === Number(b.audio?.voiceIsolation ?? 0) &&
    JSON.stringify(effects(a)) === JSON.stringify(effects(b)) &&
    Number(a.audio?.fadeOut ?? 0) === 0 &&
    Number(b.audio?.fadeIn ?? 0) === 0 &&
    a.keyframes["audio.gainDB"] == null &&
    b.keyframes["audio.gainDB"] == null
  );
}

export function enabledTracks(project: Project, kind: "video" | "audio"): readonly Track[] {
  const tracks = kind === "video" ? project.videoTracks : project.audioTracks;
  const solo = tracks.some(
    (track) => track.solo && !(kind === "video" ? track.hidden : track.muted),
  );
  return tracks.filter(
    (track) => !(kind === "video" ? track.hidden : track.muted) && (!solo || track.solo),
  );
}
export function audioSegments(project: Project) {
  return enabledTracks(project, "audio").flatMap((track) =>
    track.clips.flatMap((clip) => {
      if (!clip.enabled || clip.freezeFrame || clip.audio?.muted === true) return [];
      const reference = clip.content.media;
      const mediaID =
        reference && typeof reference === "object" && "mediaID" in reference
          ? reference.mediaID
          : null;
      if (typeof mediaID !== "string") return [];
      const item = project.media.find((media) => media.id === mediaID);
      if (!item?.hasAudio) return [];
      const windowFor = (side: "fromClipID" | "toClipID") => {
        const transition = track.transitions.find((t) => t[side] === clip.id);
        return transition ? transitionWindow(track, transition) : null;
      };
      const headWindow = windowFor("toClipID"),
        tailWindow = windowFor("fromClipID"),
        renderStart = Math.min(clip.start.seconds, headWindow?.start ?? Infinity),
        renderEnd = Math.max(
          clip.start.seconds + clip.duration.seconds,
          tailWindow?.end ?? -Infinity,
        );
      const range = {
        from: Math.max(
          0,
          clip.sourceStart.seconds + (renderStart - clip.start.seconds) * clip.speed,
        ),
        to: Math.min(
          item.duration?.seconds ?? Infinity,
          clip.sourceStart.seconds + (renderEnd - clip.start.seconds) * clip.speed,
        ),
      };
      if (range.to <= range.from) return [];
      return [
        {
          clip,
          trackID: track.id,
          mediaID,
          renderStart,
          renderEnd,
          headWindow,
          tailWindow,
          sourceStart: range.from,
          sourceEnd: range.to,
          start: clip.start.seconds + (range.from - clip.sourceStart.seconds) / clip.speed,
          end: clip.start.seconds + (range.to - clip.sourceStart.seconds) / clip.speed,
        },
      ];
    }),
  );
}
