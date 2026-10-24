import type { BrowserProjectSession } from "./browser-session";
import type { Time } from "@sidecut/contracts/time";
import { assetSuggestions } from "@sidecut/core/asset-use";
import { decodeAsset } from "@sidecut/contracts/assets";
export const MEDIA_DRAG_TYPE = "application/x-sidecut-media";

export function placeSource(
  session: BrowserProjectSession,
  mediaID: string,
  trackID: string,
  at: Time,
  mode: "place" | "insert" = "place",
) {
  const state = session.getSnapshot();
  const media = state.project.media.find((item) => item.id === mediaID);
  if (!media) throw new Error("The dragged source is no longer in this project.");
  if (state.mediaAvailability[mediaID]?.state !== "available")
    throw new Error("This source is missing or unsupported on this device.");
  const duration =
    media.kind === "image" ? (media.duration?.seconds ?? 5) : media.duration?.seconds;
  if (!duration || duration <= 0)
    throw new Error("This source needs a known positive duration before placement.");
  const id = `clip_${crypto.randomUUID()}`;
  const asset = media.asset ? decodeAsset(media.asset) : null,
    suggestedAudio = asset ? assetSuggestions(asset.kind).audio : undefined;
  session.apply({
    label: `${mode === "insert" ? "Insert" : "Place"} ${media.path.split(/[\\/]/).at(-1)}`,
    expectedRevision: state.revision,
    commands: [
      {
        insertClip: {
          trackID,
          mode,
          clip: {
            id,
            name: media.path.split(/[\\/]/).at(-1),
            content: { media: { mediaID } },
            start: at.seconds,
            duration,
            sourceStart: 0,
            ...(asset ? { tags: [`asset:${asset.id}`] } : {}),
            ...(suggestedAudio ? { audio: suggestedAudio } : {}),
          },
        },
      },
    ],
  });
  return id;
}
