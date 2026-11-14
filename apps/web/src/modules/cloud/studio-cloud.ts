import { useAction, useMutation } from "convex/react";
import { api } from "@sidecut/cloud/api";
import { useActiveTeam } from "./active-team";
import { recordingSnapshot } from "./recording-metadata";
import { RecordingUpload, putPart, type UploadProgress } from "@/modules/studio/cloud-upload";

export type CloudRecording = { upload: RecordingUpload; mediaId: Promise<string> };

/** Where Studio can save. Cloud is offered only to signed-in members who can add files. */
export type StudioCloud =
  | { state: "unavailable"; reason: string }
  | {
      state: "ready";
      teamName: string;
      begin: (
        fileName: string,
        type: string,
        onProgress: (p: UploadProgress) => void,
      ) => CloudRecording;
    };

export const LOCAL_ONLY: StudioCloud = {
  state: "unavailable",
  reason: "Cloud sign-in isn't set up for this app, so takes stay on this device.",
};

/** Call only inside CloudProvider when cloud is configured. */
export function useStudioCloud(): StudioCloud {
  const { isLoading, isAuthenticated, teams, current } = useActiveTeam();
  const create = useMutation(api.library.create);
  const beginStream = useMutation(api.versions.beginStream);
  const seal = useMutation(api.versions.seal);
  const start = useAction(api.storage.start);
  const partUrl = useAction(api.storage.partUrl);
  const complete = useAction(api.storage.complete);
  if (isLoading) return { state: "unavailable", reason: "Connecting to the cloud…" };
  if (!isAuthenticated)
    return { state: "unavailable", reason: "Sign in on Team to save takes to the cloud." };
  if (!teams) return { state: "unavailable", reason: "Loading your teams…" };
  if (!current) return { state: "unavailable", reason: "Create or join a team on Team first." };
  if (current.role === "viewer")
    return {
      state: "unavailable",
      reason: `You're a viewer in ${current.team.name}, so takes stay on this device.`,
    };
  const teamId = current.team._id;
  return {
    state: "ready",
    teamName: current.team.name,
    begin: (fileName, type, onProgress) => {
      // Recording starts at once; parts wait here until the cloud upload exists.
      const prepared = (async () => {
        const name = `Studio take ${new Date().toLocaleString()}`;
        const mediaId = await create({ teamId, name });
        const versionId = await beginStream({
          mediaId,
          requestId: crypto.randomUUID(),
          snapshot: recordingSnapshot(fileName, type),
        });
        await start({ versionId });
        return { mediaId, versionId };
      })();
      const upload = new RecordingUpload(
        {
          partUrl: async (part) => {
            const { versionId } = await prepared;
            return (await partUrl({ versionId, part })).url;
          },
          put: putPart,
          finish: async (expectedBytes, partCount) => {
            const { versionId } = await prepared;
            await seal({ versionId, expectedBytes, partCount });
            await complete({ versionId });
          },
        },
        onProgress,
      );
      return { upload, mediaId: prepared.then(({ mediaId }) => mediaId) };
    },
  };
}
