import { ProjectCoordinator } from "@sidecut/core/coordinator";
import { validateProject } from "@sidecut/core/validation";
import { decodeProjectFile } from "@sidecut/contracts/project";
import mini from "../../../../../tests/fixtures/tandem/mini.json";

export function runSessionProbe() {
  const file = decodeProjectFile(mini);
  if (validateProject(file.project).length)
    throw new Error("Reference fixture has validation issues.");
  const invalid = validateProject({ ...file.project, media: [] });
  if (!invalid.some((issue) => issue.code === "missing-media" && issue.objectID === "clip_camera"))
    throw new Error("Missing-media validation failed.");
  const session = new ProjectCoordinator(file);
  const before = session.getSnapshot();
  let atomicRejected = false;
  try {
    session.apply({
      commands: [
        { updateProject: { patch: { name: "Must not remain" } } },
        { updateSettings: { patch: { width: 0 } } },
      ],
    });
  } catch {
    atomicRejected = session.getSnapshot() === before;
  }
  if (!atomicRejected) throw new Error("Failed batch changed the project.");
  const batch = {
    label: "Browser test",
    expectedRevision: 7,
    idempotencyKey: "browser-check",
    commands: [
      { updateProject: { patch: { name: "Verified edit" } } },
      { updateSettings: { patch: { width: 1920, height: 1080 } } },
    ],
  };
  const first = session.apply(batch);
  if (session.apply(batch) !== first || session.getSnapshot().revision !== 8)
    throw new Error("Idempotent retry created a second edit.");
  let staleRejected = false;
  try {
    session.apply({ ...batch, idempotencyKey: "stale-check" });
  } catch {
    staleRejected = true;
  }
  if (!staleRejected) throw new Error("Stale revision was accepted.");
  session.undo();
  if (session.getSnapshot().project !== before.project || session.getSnapshot().revision !== 9)
    throw new Error("Undo did not restore the exact prior project.");
  session.redo();
  if (
    session.getSnapshot().project.name !== "Verified edit" ||
    session.getSnapshot().revision !== 10
  )
    throw new Error("Redo failed.");
  return {
    passed: true,
    missingMediaObjectID: "clip_camera",
    atomicRejected,
    staleRejected,
    idempotentRetry: true,
    undoRestored: true,
    finalRevision: session.getSnapshot().revision,
  };
}
