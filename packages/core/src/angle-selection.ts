// Ported from TandemCore/SyncedPlacement.swift. See tests/fixtures/tandem/TANDEM-LICENSE.
import type { Project, Clip } from "@sidecut/contracts/project";
import type { EditCommand } from "@sidecut/contracts/commands";
import type { EditContext } from "./timeline-editing";
import { requireTrack, unlocked, end, editTimeline } from "./timeline-editing";

export function editAngle(p: Project, command: EditCommand, context: EditContext): Project | null {
  if (!("showAngle" in command)) return null;
  const { range, trackID } = command.showAngle;
  const shown = requireTrack(p, trackID);
  if (shown.kind !== "video") throw new Error("showAngle picks picture, not a sound track.");
  const a = range.start.roundedToFrame(p.settings.frameRate);
  const b = range.start.add(range.duration).roundedToFrame(p.settings.frameRate);
  if (a.flicks < 0n || b.flicks <= a.flicks)
    throw new Error("Angle range must start at zero or later and last at least a frame.");
  const media = (c: Clip) =>
    p.media.find((m) => m.id === (c.content.media as { mediaID?: string } | undefined)?.mediaID);
  const intersects = (c: Clip) => c.start.flicks < b.flicks && end(c).flicks > a.flicks;
  const takes = new Set(
    shown.clips
      .filter(intersects)
      .map((c) => media(c)?.takeID)
      .filter(Boolean),
  );
  if (takes.size !== 1)
    throw new Error(`"${shown.name}" needs exactly one synced take in that range.`);
  const take = [...takes][0];
  const inTake = (c: Clip) => media(c)?.takeID === take;
  const takeTracks = p.videoTracks.filter((t) => t.clips.some((c) => intersects(c) && inTake(c)));
  const base =
    takeTracks.find((t) =>
      t.clips.some((c) => intersects(c) && inTake(c) && media(c)?.role === "camera"),
    ) ?? takeTracks[0]!;
  const angles = takeTracks.filter((t) => p.videoTracks.indexOf(t) > p.videoTracks.indexOf(base));
  if (shown !== base && !angles.includes(shown))
    throw new Error("Angles must be above the camera track.");
  if (!angles.length)
    throw new Error("The take has no other angle in that range. Place a synced angle first.");
  for (const track of angles) unlocked(track);
  for (const at of [a, b])
    for (const track of [base, ...angles]) {
      const clip = p.videoTracks
        .find((t) => t.id === track.id)!
        .clips.find((c) => c.start.flicks < at.flicks && end(c).flicks > at.flicks && inTake(c));
      if (clip) p = editTimeline(p, { blade: { at, clipIDs: [clip.id] } }, context)!;
    }
  let covered = 0n;
  p = {
    ...p,
    videoTracks: p.videoTracks.map((t) =>
      !angles.some((angle) => angle.id === t.id)
        ? t
        : {
            ...t,
            clips: t.clips.map((c) => {
              if (!inTake(c) || c.start.flicks < a.flicks || end(c).flicks > b.flicks) return c;
              const enabled = t.id === shown.id;
              if (enabled) covered += c.duration.flicks;
              return { ...c, enabled };
            }),
          },
    ),
  };
  if (shown !== base && covered < b.flicks - a.flicks)
    context.warn(`"${shown.name}" only covers part of that range; the camera shows the rest.`);
  return p;
}
