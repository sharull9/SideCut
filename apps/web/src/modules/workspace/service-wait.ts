import type { BrowserProjectSession } from "./browser-session";
import { resolveServiceMedia } from "@sidecut/core/service-sync";
import { clipMediaID, QueryError } from "@sidecut/core/project-queries";
import { speechTracks } from "@sidecut/core/speech";
import { object } from "@sidecut/core/interchange";
import { cachedMatte } from "@sidecut/platform-browser/cutout";

type WaitItem = {
  kind: string;
  mediaID?: string;
  path: string;
  state: string;
  progress?: number;
  message?: string;
  words?: number;
};
const finished = (item: WaitItem) => ["ready", "done", "failed", "cancelled"].includes(item.state);

export async function waitService(
  session: BrowserProjectSession,
  request: Record<string, unknown>,
  signal: AbortSignal,
) {
  const what = String(request.what ?? "jobs"),
    timeout = Math.min(86400, Math.max(0, Number(request.timeout ?? 600)));
  if (!["jobs", "export", "transcript", "matte", "proxy"].includes(what))
    throw new QueryError(
      "badRequest",
      "Wait target must be jobs, export, transcript, matte or proxy.",
    );
  const checkCancelled = () => {
    if (signal.aborted) throw new QueryError("unavailable", "Wait cancelled.");
  };
  checkCancelled();
  const file = session.projectFile(),
    projectID = file.project.id,
    started = performance.now();
  const selected = resolveServiceMedia(file.project, (request.media as string[] | undefined) ?? []);
  const ids = new Set(selected.map((m) => m.id));
  const tracks = [...file.project.videoTracks, ...file.project.audioTracks];
  const placed = new Set(tracks.flatMap((t) => t.clips.filter((c) => c.enabled).map(clipMediaID)));
  const speech = new Set(
    speechTracks(file.project).flatMap((t) => t.clips.filter((c) => c.enabled).map(clipMediaID)),
  );
  const cutouts = new Set(
    tracks.flatMap((t) =>
      t.clips
        .filter((c) => c.enabled && object(object(c.video ?? {}).cutout ?? {}).enabled === true)
        .map(clipMediaID),
    ),
  );
  const targets: { kind: string; mediaID: string; path: string }[] = [];
  const failures = new Map<string, string>();
  for (const item of file.project.media) {
    const needs = [
      ...(item.hasAudio &&
      (item.role === "camera" || item.transcribe === true || speech.has(item.id))
        ? ["transcript"]
        : []),
      ...(cutouts.has(item.id) && (item.kind === "video" || item.kind === "image")
        ? ["matte"]
        : []),
      ...(placed.has(item.id) &&
      item.kind === "video" &&
      ((item.width ?? 0) > 1920 || (item.height ?? 0) > 1080)
        ? ["proxy"]
        : []),
    ];
    if (what === "export" || (ids.size && !ids.has(item.id))) continue;
    await session.analysis.load(item.id).catch(() => {});
    const memory = session.analysis.getSnapshot()[item.id];
    let matte = memory?.matte;
    if (what === "matte" && !matte) {
      const resource = await session.resource(item.id);
      if (resource?.state === "available") matte = await cachedMatte(resource.file);
    }
    const ready = new Set([
      ...(memory?.transcript ? ["transcript"] : []),
      ...(memory?.proxy ? ["proxy"] : []),
      ...(matte ? ["matte"] : []),
    ]);
    if (ids.has(item.id) && what !== "jobs" && !needs.includes(what) && !ready.has(what))
      throw new QueryError(
        "badRequest",
        `Nothing makes ${what} for ${item.path}. Ask for transcription, enable cutout, or place large video on the timeline first.`,
      );
    for (const kind of what === "jobs"
      ? needs
      : needs.includes(what) || ready.has(what)
        ? [what]
        : []) {
      targets.push({ kind, mediaID: item.id, path: item.path });
    }
  }
  // Schedule only after every target has been validated. A wait owns no analysis cancellation.
  checkCancelled();
  for (const target of targets) {
    const memory = session.analysis.getSnapshot()[target.mediaID];
    if (
      (target.kind === "transcript" && memory?.transcript) ||
      (target.kind === "proxy" && memory?.proxy) ||
      (target.kind === "matte" && memory?.matte)
    )
      continue;
    const task =
      target.kind === "transcript"
        ? session.analysis.transcribe(target.mediaID)
        : target.kind === "matte"
          ? session.analysis.cutout(target.mediaID)
          : session.analysis.generateProxy(target.mediaID);
    void task.catch((error: unknown) =>
      failures.set(
        `${target.kind}:${target.mediaID}`,
        error instanceof Error ? error.message : String(error),
      ),
    );
  }
  const seen = new Set<string>();
  const items = (): WaitItem[] => {
    const jobs = session.jobs.getSnapshot();
    if (what === "export") {
      const entries = session.exports.getSnapshot();
      for (const e of entries) if (["queued", "running"].includes(e.status)) seen.add(e.id);
      return entries
        .filter((e) => seen.has(e.id))
        .map((e) => ({
          kind: "export",
          path: e.name,
          state: e.status,
          progress: e.progress,
          ...(e.status === "failed" ? { message: e.error } : {}),
        }));
    }
    const results: WaitItem[] = targets.map((target) => {
      const memory = session.analysis.getSnapshot()[target.mediaID];
      const transcript = session.analysis.transcriptFor({ id: target.mediaID });
      const ready =
        target.kind === "transcript"
          ? !!transcript
          : target.kind === "proxy"
            ? !!memory?.proxy
            : !!memory?.matte;
      const operation =
        target.kind === "transcript"
          ? "Local transcription"
          : target.kind === "proxy"
            ? "Generate proxy"
            : "Analyse cutout";
      const job = jobs.find((j) => j.id === `${operation}:${target.mediaID}`);
      const message = failures.get(`${target.kind}:${target.mediaID}`) ?? job?.error;
      return {
        ...target,
        state: ready
          ? "ready"
          : message
            ? "failed"
            : job?.status === "done"
              ? "failed"
              : (job?.status ?? "waiting"),
        ...(ready && transcript && target.kind === "transcript"
          ? { words: transcript.words.length }
          : {}),
        ...(message && !ready ? { message } : {}),
        ...(job?.status === "running" ? { progress: job.progress } : {}),
      };
    });
    if (what === "jobs")
      for (const job of jobs.filter(
        (j) =>
          !j.id.startsWith("export") &&
          (!ids.size || [...ids].some((id) => j.id.endsWith(`:${id}`))),
      )) {
        if (["queued", "running"].includes(job.status)) seen.add(job.id);
        if (
          seen.has(job.id) &&
          !targets.some(
            (t) =>
              job.id.endsWith(`:${t.mediaID}`) &&
              job.id.startsWith(
                t.kind === "transcript"
                  ? "Local transcription:"
                  : t.kind === "matte"
                    ? "Analyse cutout:"
                    : "Generate proxy:",
              ),
          )
        )
          results.push({
            kind: job.id.split(":")[0]!,
            path: job.label,
            state: job.status,
            progress: job.progress,
            ...(job.error ? { message: job.error } : {}),
          });
      }
    return results;
  };
  while (true) {
    checkCancelled();
    if (session.getSnapshot().project.id !== projectID)
      throw new QueryError("unavailable", "Project replaced during wait.");
    const all = items(),
      pending = all.filter((i) => !finished(i)),
      elapsed = (performance.now() - started) / 1000;
    if (!pending.length || elapsed >= timeout)
      return {
        what,
        revision: session.getSnapshot().revision,
        done: !pending.length,
        timedOut: !!pending.length,
        elapsed,
        finished: all.filter(finished),
        pending,
        items:
          what === "jobs"
            ? session.jobs
                .getSnapshot()
                .filter(
                  (j) =>
                    !j.id.startsWith("export") &&
                    (!ids.size || [...ids].some((id) => j.id.endsWith(`:${id}`))),
                )
            : all,
      };
    await new Promise<void>((resolve, reject) => {
      const abort = () => {
        clearTimeout(timer);
        reject(new QueryError("unavailable", "Wait cancelled."));
      };
      const timer = setTimeout(
        () => {
          signal.removeEventListener("abort", abort);
          resolve();
        },
        Math.min(250, (timeout - elapsed) * 1000),
      );
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    });
  }
}
