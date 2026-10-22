// Raw audio scheduling slice of TandemRender/RenderPlan.swift. Gain/fades are a later phase.
import type { Project, Track } from "@sidecut/contracts/project";

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
      const range = {
        from: Math.max(0, clip.sourceStart.seconds),
        to: Math.min(
          item.duration?.seconds ?? Infinity,
          clip.sourceStart.seconds + clip.duration.seconds * clip.speed,
        ),
      };
      if (range.to <= range.from) return [];
      return [
        {
          clip,
          trackID: track.id,
          mediaID,
          sourceStart: range.from,
          sourceEnd: range.to,
          start: clip.start.seconds + (range.from - clip.sourceStart.seconds) / clip.speed,
          end: clip.start.seconds + (range.to - clip.sourceStart.seconds) / clip.speed,
        },
      ];
    }),
  );
}
