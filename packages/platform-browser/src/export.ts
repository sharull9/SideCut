import { mixTimelineAudio } from "./audio";
import { measureSource } from "./audio-analysis";
import { createLUTLoader } from "./lut";
import { effectsOf } from "@sidecut/core/effect-editing";
import { resolvedParams } from "@sidecut/core/effects";
import type { ClipEffect } from "@sidecut/contracts/project";
import { paintPicture } from "./picture";
import type { Project, Clip } from "@sidecut/contracts/project";
import { enabledTracks, exportPlan, projectDuration } from "@sidecut/core/render-plan";
import type { LocalResource } from "./storage";
import { LocalMediaReader } from "./preview";

export async function renderWebM(
  project: Project,
  resource: (id: string) => Promise<LocalResource | null>,
  externalSignal: AbortSignal,
  onProgress: (progress: number) => void,
  options: { start?: number; end?: number; master?: boolean } = {},
): Promise<Blob> {
  const work = new AbortController();
  const signal = AbortSignal.any([externalSignal, work.signal]);
  const plan = exportPlan(project);
  const start = options.start ?? 0,
    end = options.end ?? projectDuration(project).seconds;
  if (start < 0 || end <= start || end > projectDuration(project).seconds + 1 / plan.fps)
    throw new Error("Invalid export range.");
  const count = Math.ceil((end - start) * plan.fps - 1e-7);
  const lut = createLUTLoader(resource);
  signal.throwIfAborted();
  const {
    Output,
    WebMOutputFormat,
    BufferTarget,
    CanvasSource,
    AudioSampleSource,
    AudioSample,
    canEncodeVideo,
    canEncodeAudio,
  } = await import("mediabunny");
  if (
    !(await canEncodeVideo("vp8", {
      width: plan.width,
      height: plan.height,
      bitrate: 4_000_000,
    })) ||
    (plan.hasAudio && !(await canEncodeAudio("opus")))
  )
    throw new Error("This browser cannot encode the required VP8/Opus WebM format.");
  signal.throwIfAborted();
  const canvas = document.createElement("canvas");
  canvas.width = plan.width;
  canvas.height = plan.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas export is unavailable.");
  const target = new BufferTarget(),
    output = new Output({ format: new WebMOutputFormat(), target });
  const video = new CanvasSource(canvas, { codec: "vp8", bitrate: 4_000_000 });
  output.addVideoTrack(video, { frameRate: plan.fps });
  const audio = plan.hasAudio ? new AudioSampleSource({ codec: "opus", bitrate: 128_000 }) : null;
  if (audio) output.addAudioTrack(audio);
  const readers = new Map<string, Promise<LocalMediaReader>>();
  const id = (clip: Clip) => {
    const media = clip.content.media;
    if (
      media &&
      typeof media === "object" &&
      "mediaID" in media &&
      typeof media.mediaID === "string"
    )
      return media.mediaID;
    throw new Error("Export requires media clips.");
  };
  const reader = (mediaID: string) => {
    let value = readers.get(mediaID);
    if (!value) {
      value = (async () => {
        const media = project.media.find((m) => m.id === mediaID),
          local = await resource(mediaID);
        signal.throwIfAborted();
        if (!media || !local || local.state !== "available")
          throw new Error(`Source ${media?.path ?? mediaID} is missing or unsupported.`);
        return LocalMediaReader.open(local.file, media.kind, plan.width);
      })();
      readers.set(mediaID, value);
    }
    return value;
  };
  let finished = false;
  const cancel = () => {
    void output.cancel().catch(() => {});
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    // Resolve every used source before encoding so a missing later clip cannot produce a partial download.
    const mediaIDs = new Set(
      [...enabledTracks(project, "video"), ...enabledTracks(project, "audio")].flatMap((t) =>
        t.clips
          .filter((c) => c.enabled && !(t.kind === "audio" && (c.audio?.muted || c.freezeFrame)))
          .filter((c) => c.content.media != null)
          .map(id),
      ),
    );
    await Promise.all([...mediaIDs].map(reader));
    const paths = new Set<string>();
    for (const track of enabledTracks(project, "video"))
      for (const clip of track.clips.filter((c) => c.enabled)) {
        const mediaID =
          clip.content.media &&
          typeof clip.content.media === "object" &&
          "mediaID" in clip.content.media
            ? clip.content.media.mediaID
            : null;
        const media = project.media.find((m) => m.id === mediaID);
        for (const fx of [
          ...((media?.look ?? []) as readonly ClipEffect[]),
          ...effectsOf(clip, "video"),
        ]) {
          if (
            fx.enabled === false ||
            fx.type !== "lut" ||
            (Number(resolvedParams(fx).intensity) === 0 &&
              !clip.keyframes[`video.effects.${fx.id}.intensity`]?.length)
          )
            continue;
          paths.add(String(resolvedParams(fx).path ?? ""));
          for (const key of clip.keyframes[`video.effects.${fx.id}.path`] ?? [])
            if (typeof key.value === "string") paths.add(key.value);
        }
      }
    await Promise.all([...paths].map(lut));
    signal.throwIfAborted();
    await output.start();
    const picture = async () => {
      for (let index = 0; index < count; index++) {
        signal.throwIfAborted();
        const time = index / plan.fps;
        await paintPicture(ctx, project, start + time, reader, signal, lut);
        await video.add(time, 1 / plan.fps);
        onProgress(((index + 1) / count) * 0.95);
        if (index % 3 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
      }
      video.close();
    };
    const sound = async () => {
      if (!audio) return;
      for await (const block of mixTimelineAudio(project, reader, signal, 48000, 4096, end, {
        start,
        master: options.master ?? true,
        measure: async (mediaID) => {
          const local = await resource(mediaID);
          if (!local || local.state !== "available")
            throw new Error(`Source ${mediaID} is missing.`);
          return measureSource(local.file, await reader(mediaID), signal);
        },
      })) {
        signal.throwIfAborted();
        const sample = new AudioSample({
          data: block.data,
          format: "f32-planar",
          sampleRate: block.sampleRate,
          numberOfChannels: block.numberOfChannels,
          timestamp: options.master === false ? block.timestamp - start : block.timestamp,
        });
        try {
          await audio.add(sample);
        } finally {
          sample.close();
        }
      }
      audio.close();
    };
    const jobs = [picture(), sound()];
    try {
      await Promise.all(jobs);
    } catch (error) {
      work.abort();
      await Promise.allSettled(jobs);
      throw error;
    }
    signal.throwIfAborted();
    await output.finalize();
    signal.throwIfAborted();
    if (!target.buffer) throw new Error("Export did not produce a file.");
    finished = true;
    onProgress(1);
    return new Blob([target.buffer], { type: "video/webm" });
  } catch (error) {
    if (externalSignal.aborted) throw new DOMException("Export cancelled.", "AbortError");
    throw error;
  } finally {
    signal.removeEventListener("abort", cancel);
    if (!finished) await output.cancel().catch(() => {});
    for (const pending of readers.values())
      void pending.then(
        (value) => value.close(),
        () => {},
      );
    canvas.width = 0;
    canvas.height = 0;
  }
}
