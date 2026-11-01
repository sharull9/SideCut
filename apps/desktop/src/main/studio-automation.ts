import type { ProjectFile } from "@sidecut/contracts/project";
import { LiveStudio } from "@sidecut/core/live-studio";
import { object } from "@sidecut/core/interchange";
import { ProjectCoordinator, EditError } from "@sidecut/core/coordinator";
import { QueryError } from "@sidecut/core/project-queries";
import type { NativeRecorder } from "./native-recorder.ts";

const stateKey = "sidecut.liveStudio";
const intentKey = "sidecut.studioIntent";
export type StudioRecorder = Pick<NativeRecorder, "list" | "stop" | "streamStatus">;

export async function studioOperation(
  file: ProjectFile,
  request: Record<string, unknown>,
  apply: (batch: Record<string, unknown>) => unknown,
  recorder: StudioRecorder | undefined,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const encoded = file.project.metadata[stateKey];
  const studio = encoded ? LiveStudio.restore(encoded) : new LiveStudio();
  const snapshotStatus = () => {
    let activeSceneID: string | null = null;
    try {
      activeSceneID = studio.frame(0).sceneId;
    } catch {
      /* No scene selected yet. */
    }
    return {
      projectID: file.project.id,
      revision: file.revision,
      studioRevision: studio.currentRevision,
      scenes: studio.list(),
      activeSceneID,
    };
  };
  if (request.action === "status") return snapshotStatus();
  if (request.action === "recording-status") {
    if (!recorder) throw new QueryError("notImplemented", "Native recording is unavailable.");
    const recordings = (await recorder.list())
      .filter((row) => row.projectID === file.project.id)
      .map(({ id, status, elapsedSeconds }) => ({ id, status, elapsedSeconds }));
    return { ...snapshotStatus(), recordings };
  }
  if (!["save", "switch", "remove", "recording-stop"].includes(String(request.action)))
    throw new QueryError(
      "badRequest",
      "Unknown studio action. Start recording through the visible desktop controls.",
    );
  if (
    typeof request.idempotencyKey !== "string" ||
    !/^[a-zA-Z0-9:_-]{1,160}$/.test(request.idempotencyKey) ||
    request.expectedRevision == null ||
    request.studioRevision == null ||
    typeof request.id !== "string"
  )
    throw new QueryError(
      "badRequest",
      "Studio mutations need an ID, both revisions and an idempotency key.",
    );
  const intent = JSON.stringify([
    request.action,
    request.id,
    request.name ?? null,
    request.expectedRevision,
    request.studioRevision,
    request.author ?? "agent",
  ]);
  const previous = new ProjectCoordinator(file)
    .journalEntries()
    .find((entry) => entry.batch?.idempotencyKey === request.idempotencyKey);
  if (previous?.batch) {
    const command = previous.batch.commands[0];
    const metadata = object(object(command?.updateProject ?? {}).patch ?? {}).metadata;
    if (
      !metadata ||
      typeof metadata !== "object" ||
      Array.isArray(metadata) ||
      !(intentKey in metadata) ||
      metadata[intentKey] !== intent
    )
      throw new QueryError(
        "badRequest",
        "Studio idempotency key conflicts with an earlier action.",
      );
    return { ...snapshotStatus(), result: previous.result, replayed: true };
  }
  if (
    request.expectedRevision !== file.revision ||
    request.studioRevision !== studio.currentRevision
  )
    throw new EditError("stale-revision", "Studio or project changed. Refresh before retrying.");
  if (request.action === "recording-stop") {
    if (!recorder) throw new QueryError("notImplemented", "Native recording is unavailable.");
    const recording = (await recorder.list()).find(
      (row) => row.id === request.id && row.projectID === file.project.id,
    );
    signal.throwIfAborted();
    if (!recording) throw new QueryError("notFound", "Recording unavailable in this project.");
    if (recording.status !== "recording")
      return {
        ...snapshotStatus(),
        recording: { id: recording.id, status: recording.status },
        replayed: true,
      };
    const stopped = await recorder.stop(recording.id);
    return { ...snapshotStatus(), recording: { id: stopped.id, status: stopped.status } };
  }
  if (request.action === "save") {
    const { [stateKey]: _state, [intentKey]: _intent, ...metadata } = file.project.metadata;
    studio.save({
      id: request.id,
      name: typeof request.name === "string" ? request.name : request.id,
      project: { ...file.project, metadata },
      expectedRevision: studio.currentRevision,
    });
  } else if (request.action === "switch")
    studio.switch({ id: request.id, expectedRevision: studio.currentRevision });
  else studio.remove({ id: request.id, expectedRevision: studio.currentRevision });
  signal.throwIfAborted();
  const result = apply({
    author: request.author ?? "agent",
    label: `Studio ${request.action}: ${request.id}`,
    expectedRevision: file.revision,
    idempotencyKey: request.idempotencyKey,
    commands: [
      {
        updateProject: {
          patch: { metadata: { [stateKey]: studio.serialize(), [intentKey]: intent } },
        },
      },
    ],
  });
  return { ...snapshotStatus(), revision: file.revision + 1, result };
}
