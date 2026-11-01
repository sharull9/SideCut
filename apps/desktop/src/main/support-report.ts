import type { HostSnapshot } from "@sidecut/contracts/desktop";
import { decodeProjectFile } from "@sidecut/contracts/project";
import { validateProject } from "@sidecut/core/validation";
import type { StudioRecorder } from "./studio-automation.ts";

// Construct from approved scalar fields; never redact a serialized project or raw log.
export async function supportReport(
  snapshot: HostSnapshot,
  rendererReady: boolean,
  nativeMediaConfigured: boolean,
  recorder: Pick<StudioRecorder, "list"> | undefined,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const file = decodeProjectFile(JSON.parse(snapshot.json));
  const project = file.project;
  const issues = validateProject(project);
  const memory = process.memoryUsage();
  const states = { recording: 0, stopping: 0, ready: 0, interrupted: 0, error: 0 };
  let recordingStatus: "available" | "unavailable" = "unavailable";
  if (recorder) {
    try {
      for (const recording of await recorder.list())
        if (recording.projectID === project.id) states[recording.status]++;
      recordingStatus = "available";
    } catch {
      // Journal errors can contain paths or device names. Report availability only.
    }
  }
  signal.throwIfAborted();
  return {
    format: "sidecut-support",
    version: 1,
    createdAt: new Date().toISOString(),
    runtime: {
      platform: process.platform,
      arch: process.arch,
      node: process.versions.node,
      electron: process.versions.electron ?? null,
      chrome: process.versions.chrome ?? null,
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
    },
    services: { rendererReady, nativeMediaConfigured },
    project: {
      schemaVersion: project.schemaVersion,
      revision: file.revision,
      saveState: snapshot.saveState,
      saveError: snapshot.error !== null,
      width: project.settings.width,
      height: project.settings.height,
      frameRate: {
        numerator: project.settings.frameRate.numerator,
        denominator: project.settings.frameRate.denominator,
      },
      mediaCount: project.media.length,
      videoTrackCount: project.videoTracks.length,
      audioTrackCount: project.audioTracks.length,
      clipCount: [...project.videoTracks, ...project.audioTracks].reduce(
        (count, track) => count + track.clips.length,
        0,
      ),
      validation: {
        errors: issues.filter((issue) => issue.severity === "error").length,
        warnings: issues.filter((issue) => issue.severity === "warning").length,
      },
    },
    recordings: { status: recordingStatus, counts: states },
  };
}
