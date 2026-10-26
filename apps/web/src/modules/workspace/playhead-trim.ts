import type { Project } from "@sidecut/contracts/project";
import type { EditCommandInput } from "@sidecut/contracts/commands";
import type { Time } from "@sidecut/contracts/time";

// TimelineEdits.clipForPlayheadTrim/rippleTrimToPlayhead at the pinned reference.
export function playheadTrim({
  project,
  playhead,
  selected,
  edge,
}: {
  project: Project;
  playhead: Time;
  selected: readonly string[];
  edge: "start" | "end";
}) {
  const all = [...project.videoTracks, ...project.audioTracks].flatMap((track) => track.clips);
  const inside = (clip: Project["videoTracks"][number]["clips"][number]) =>
    clip.start.flicks < playhead.flicks &&
    playhead.flicks < clip.start.flicks + clip.duration.flicks;
  let clip = all.find((candidate) => selected.includes(candidate.id) && inside(candidate));
  if (!clip) {
    const tracks = [...project.videoTracks.toReversed(), ...project.audioTracks];
    const take = tracks
      .filter((track) => track.rippleMode === "cut" && !track.locked)
      .flatMap((track) =>
        track.clips.filter(
          (candidate) =>
            candidate.start.flicks <= playhead.flicks &&
            playhead.flicks < candidate.start.flicks + candidate.duration.flicks,
        ),
      );
    clip = take.length
      ? take.find(inside)
      : tracks
          .filter((track) => track.targeted && !track.locked)
          .flatMap((track) => track.clips)
          .find(inside);
  }
  if (!clip) return null;
  const partners = all.filter(
    (candidate) =>
      candidate.id === clip.id || (clip.linkGroup && candidate.linkGroup === clip.linkGroup),
  );
  const includeLinked =
    !selected.length ||
    !selected.includes(clip.id) ||
    partners.every((partner) => selected.includes(partner.id));
  return {
    label: `Ripple trim ${edge} to playhead`,
    commands: [
      { trim: { clipID: clip.id, edge, to: playhead.seconds, ripple: true, includeLinked } },
    ] satisfies EditCommandInput[],
    playhead: edge === "start" ? clip.start : playhead,
  };
}
