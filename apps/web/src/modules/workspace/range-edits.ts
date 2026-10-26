import type { Project } from "@sidecut/contracts/project";
import type { EditCommandInput } from "@sidecut/contracts/commands";
/** Ported from Tandem's TimelineEdits.liftRange/extractRange; see the fixture MIT notice. */
export function rangeEdit(project: Project, from: number, to: number, ripple: boolean) {
  if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to <= from)
    throw new Error("Set in and out points first (I and O).");
  const trackIDs = [...project.videoTracks, ...project.audioTracks]
    .filter((track) => !track.locked)
    .map((track) => track.id);
  if (!trackIDs.length) return null;
  const range = { start: from, duration: to - from };
  const commands: EditCommandInput[] = [{ rippleDeleteRange: { range, trackIDs } }];
  if (!ripple) {
    commands.push({ insertTime: { at: from, duration: to - from, trackIDs } });
    for (const marker of project.markers)
      if (marker.time > from && marker.time < to)
        commands.push({ updateMarker: { markerID: marker.id, patch: { time: marker.time } } });
  }
  return { label: ripple ? "Extract in to out" : "Lift in to out", commands };
}
