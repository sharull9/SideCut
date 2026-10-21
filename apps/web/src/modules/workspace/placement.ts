import type { BrowserProjectSession } from "./browser-session";
import type { Time } from "@sidecut/contracts/time";
export const MEDIA_DRAG_TYPE = "application/x-sidecut-media";

export function placeSource(
  session: BrowserProjectSession,
  mediaID: string,
  trackID: string,
  at: Time,
) {
  const state = session.getSnapshot();
  const media = state.project.media.find((item) => item.id === mediaID);
  if (!media) throw new Error("The dragged source is no longer in this project.");
  if (state.mediaAvailability[mediaID]?.state !== "available")
    throw new Error("This source is missing or unsupported on this device.");
  const duration = media.kind === "image" ? 5 : media.duration?.seconds;
  if (!duration || duration <= 0)
    throw new Error("This source needs a known positive duration before placement.");
  const id = `clip_${crypto.randomUUID()}`;
  session.apply({
    label: `Place ${media.path.split(/[\\/]/).at(-1)}`,
    expectedRevision: state.revision,
    commands: [
      {
        insertClip: {
          trackID,
          mode: "place",
          clip: {
            id,
            name: media.path.split(/[\\/]/).at(-1),
            content: { media: { mediaID } },
            start: at.seconds,
            duration,
            sourceStart: 0,
          },
        },
      },
    ],
  });
  return id;
}
