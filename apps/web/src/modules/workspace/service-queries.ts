import type { BrowserProjectSession } from "./browser-session";
import {
  analysisKinds,
  analysisJobKinds,
  decodeQueryState,
  type QueryState,
} from "@sidecut/core/query-state";
import { queryTimeline, queryRequest } from "@sidecut/core/project-queries";
import { missingFonts, missingFontWarning } from "@sidecut/core/text";
import { fontAvailable, restoreFonts } from "@sidecut/platform-browser/text";
import { cachedMatte } from "@sidecut/platform-browser/cutout";
import { cachedSourceMeasurement, audioIdentity } from "@sidecut/platform-browser/audio-analysis";
import { derivedCache } from "@sidecut/platform-browser/derived-cache";
import type { SourceSamples } from "@sidecut/platform-browser/source-analysis";
import { object } from "@sidecut/core/interchange";

export async function rendererQuery(
  session: BrowserProjectSession,
  operation: "query-state" | "timeline",
  input: unknown,
  signal: AbortSignal,
) {
  const file = session.projectFile();
  if (operation === "timeline") {
    const { request } = queryRequest(operation, input);
    if (request.words === true) await session.analysis.prepareSpeech();
    signal.throwIfAborted();
    return queryTimeline(file, input, session.analysis.transcriptFor);
  }
  const jobs: QueryState["jobs"][number][] = [];
  for (const job of session.jobs.getSnapshot()) {
    const separator = job.id.indexOf(":"),
      operationName = job.id.slice(0, separator),
      mediaID = job.id.slice(separator + 1);
    if (separator < 0) continue;
    const item = file.project.media.find((m) => m.id === mediaID);
    for (const kind of (analysisJobKinds[operationName] ?? []).filter(
      (candidate) => item != null && analysisKinds(item).includes(candidate),
    ))
      jobs.push({
        id: `${job.id}:${kind}`,
        mediaID,
        kind,
        state: job.status === "done" ? "ready" : job.status,
        progress: job.progress,
        ...(job.error ? { message: job.error } : {}),
      });
  }
  const media: Record<string, QueryState["media"][string]> = {};
  for (const item of object(input).includeMedia === true ? file.project.media : []) {
    signal.throwIfAborted();
    const resource = await session.resource(item.id),
      exists = resource?.state === "available";
    const ready = new Set<string>();
    if (exists && resource) {
      await session.analysis.load(item.id);
      const memory = session.analysis.getSnapshot()[item.id];
      const samples =
        memory?.samples ??
        (await derivedCache<SourceSamples>(`samples:1:${await audioIdentity(resource.file)}`));
      if (samples?.thumbnails.length) ready.add("thumbnails");
      if (samples?.peaks.length) ready.add("waveform");
      if (memory?.proxy) ready.add("proxy");
      if (session.analysis.transcriptFor(item)) ready.add("transcript");
      if (memory?.matte || (await cachedMatte(resource.file))) ready.add("matte");
      if (item.hasAudio && (await cachedSourceMeasurement(resource.file))) ready.add("loudness");
    }
    const analysis: Record<string, QueryState["media"][string]["analysis"][string]> = {};
    for (const kind of analysisKinds(item)) {
      const job = jobs.findLast((j) => j.mediaID === item.id && j.kind === kind);
      analysis[kind] = ready.has(kind)
        ? { state: "ready" }
        : job
          ? {
              state: job.state === "ready" ? "none" : job.state,
              ...(job.state === "running" ? { progress: job.progress } : {}),
              ...(job.state === "failed" && job.message ? { message: job.message } : {}),
            }
          : { state: "none" };
    }
    media[item.id] = { exists, analysis };
  }
  signal.throwIfAborted();
  await restoreFonts();
  return decodeQueryState({
    projectID: file.project.id,
    revision: file.revision,
    media,
    jobs,
    exports: session.exports.getSnapshot().map((entry) => ({
      id: entry.id,
      output: entry.name,
      preset: entry.preset ?? "unknown",
      progress: entry.progress,
      state:
        entry.status === "done"
          ? "done"
          : entry.status === "failed" || entry.status === "cancelled"
            ? "failed"
            : "running",
      ...(entry.status === "failed"
        ? { message: entry.error }
        : entry.status === "cancelled"
          ? { message: "Cancelled" }
          : entry.status === "queued"
            ? { message: "Queued" }
            : {}),
    })),
    warnings: missingFonts(file.project, fontAvailable).map((font) => missingFontWarning(font)),
  });
}
