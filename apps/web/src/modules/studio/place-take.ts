import { projectDuration } from "@sidecut/core/render-plan";
import type { BrowserProjectSession } from "@/modules/workspace/browser-session";
import type { TakeMark } from "./take-store";

/**
 * Adds a take to the project and, when its length is known, places it after everything already on
 * the timeline with a marker for each moment marked while recording.
 */
export async function addTakeToProject(
  session: BrowserProjectSession,
  file: File,
  marks: readonly TakeMark[],
): Promise<"timeline" | "media"> {
  const [mediaID] = await session.importFiles([file]);
  if (!mediaID) throw new Error(`${file.name} could not be added to the project.`);
  const state = session.getSnapshot();
  const media = state.project.media.find((item) => item.id === mediaID);
  if (state.mediaAvailability[mediaID]?.state !== "available" || !media?.duration?.seconds)
    return "media";
  const at = projectDuration(state.project).seconds;
  session.apply({
    label: `Place ${file.name}`,
    expectedRevision: state.revision,
    commands: [
      { placeMedia: { mediaIDs: [mediaID], at, mode: "place" } },
      ...marks.map((mark) => ({
        addMarker: { marker: { time: at + mark.seconds, name: mark.name, kind: "marker" } },
      })),
    ],
  });
  return "timeline";
}

export const placedMessage = (name: string, where: "timeline" | "media") =>
  where === "timeline"
    ? `${name} was added to Project media and placed at the end of the timeline.`
    : `${name} was added to Project media.`;
