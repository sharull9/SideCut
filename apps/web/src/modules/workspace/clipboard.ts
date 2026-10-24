import type { Project, Clip } from "@sidecut/contracts/project";
import { object } from "@sidecut/core/interchange";
export interface ClipClipboard {
  projectID: string;
  origin: number;
  clips: { trackID: string; clip: Clip }[];
}
export function copyClips(project: Project, ids: readonly string[]): ClipClipboard {
  const tracks = [...project.videoTracks, ...project.audioTracks];
  const clips = tracks.flatMap((t) =>
    t.clips.filter((c) => ids.includes(c.id)).map((clip) => ({ trackID: t.id, clip })),
  );
  if (!clips.length) throw new Error("Select clips to copy.");
  if (
    tracks.some((t) =>
      t.transitions.some(
        (x) => ids.includes(String(x.fromClipID)) || ids.includes(String(x.toClipID)),
      ),
    )
  )
    throw new Error(
      "Copying clips with transitions is not supported yet. Save a segment to preserve them.",
    );
  return {
    projectID: project.id,
    origin: Math.min(...clips.map((c) => c.clip.start.seconds)),
    clips,
  };
}
export function pasteClips(
  project: Project,
  clipboard: ClipClipboard,
  at: number,
  id: () => string,
) {
  if (project.id !== clipboard.projectID)
    throw new Error(
      "This clipboard belongs to another project. Use a saved segment to copy between projects.",
    );
  const links = new Map<string, string>();
  return clipboard.clips.map(({ trackID, clip }) => {
    const copy = object(JSON.parse(JSON.stringify(clip)));
    const link = clip.linkGroup;
    if (link && !links.has(link)) links.set(link, id());
    return {
      insertClip: {
        trackID,
        clip: {
          ...copy,
          id: id(),
          start: at + clip.start.seconds - clipboard.origin,
          ...(link ? { linkGroup: links.get(link) } : {}),
        },
      },
    };
  });
}
