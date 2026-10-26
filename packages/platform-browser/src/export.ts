import { yieldTask } from "./yield-task";
import { exportOutput } from "./export-output";
import { mixTimelineAudio } from "./audio";
import { measureSource } from "./audio-analysis";
import { createLUTLoader } from "./lut";
import { effectsOf } from "@sidecut/core/effect-editing";
import { resolvedParams } from "@sidecut/core/effects";
import type { ClipEffect } from "@sidecut/contracts/project";
import { paintPicture } from "./picture";
import type { Project, Clip } from "@sidecut/contracts/project";
import { enabledTracks, exportPlan, projectDuration } from "@sidecut/core/render-plan";
import { audioSegments } from "@sidecut/core/audio-plan";
import { transitionWindow } from "@sidecut/core/transitions";
import type { LocalResource } from "./storage";
import { LoudnessMeter, type MeasuredSound } from "@sidecut/core/loudness";
import { LocalMediaReader } from "./preview";

export async function renderWebM(
  project: Project,
  resource: (id: string) => Promise<LocalResource | null>,
  externalSignal: AbortSignal,
  onProgress: (progress: number) => void,
  options: {
    start?: number;
    end?: number;
    master?: boolean;
    fullResolution?: boolean;
    bitrate?: number;
    onLoudness?: (measurement: MeasuredSound) => void;
  } = {},
): Promise<Blob> {
  const work = new AbortController();
  const signal = AbortSignal.any([externalSignal, work.signal]);
  const bitrate = options.bitrate ?? 4000000;
  const start = options.start ?? 0,
    end = options.end ?? projectDuration(project).seconds;
  const plan = exportPlan(project, options.fullResolution, { start, end });
  const count = Math.ceil((end - start) * plan.fps - 1e-7);
  const lut = createLUTLoader(resource);
  signal.throwIfAborted();
  const {
    Output,
    WebMOutputFormat,
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
      bitrate,
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
  const destination = await exportOutput(
    plan.duration > 300 || (bitrate * plan.duration) / 8 > 64 * 1024 * 1024,
  );
  const output = new Output({ format: new WebMOutputFormat(), target: destination.target });
  const video = new CanvasSource(canvas, { codec: "vp8", bitrate });
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
    const pictureClips = enabledTracks(project, "video").flatMap((track) => {
      const handles = new Set(
        track.transitions.flatMap((transition) => {
          const window = transitionWindow(track, transition);
          return window && window.start < end && window.end > start
            ? [transition.fromClipID, transition.toClipID]
            : [];
        }),
      );
      return track.clips.filter(
        (clip) =>
          clip.enabled &&
          ((clip.start.seconds < end && clip.start.seconds + clip.duration.seconds > start) ||
            handles.has(clip.id)),
      );
    });
    const soundClips = audioSegments(project)
      .filter((segment) => segment.start < end && segment.end > start)
      .map((segment) => segment.clip);
    const mediaIDs = new Set(
      [...pictureClips, ...soundClips].filter((clip) => clip.content.media != null).map(id),
    );
    await Promise.all([...mediaIDs].map(reader));
    const paths = new Set<string>();
    for (const clip of pictureClips) {
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
        if (index % 3 === 0) await yieldTask();
      }
      video.close();
    };
    const sound = async () => {
      if (!audio) return;
      const meter = new LoudnessMeter(48000, 2);
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
        meter.process([block.data.subarray(0, block.frames), block.data.subarray(block.frames)]);
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
      options.onLoudness?.(meter.result());
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
    const blob = await destination.finish();
    finished = true;
    onProgress(1);
    return blob;
  } catch (error) {
    if (externalSignal.aborted) throw new DOMException("Export cancelled.", "AbortError");
    throw error;
  } finally {
    signal.removeEventListener("abort", cancel);
    if (!finished) {
      await output.cancel().catch(() => {});
      await destination.cancel();
    }
    for (const pending of readers.values())
      void pending.then(
        (value) => value.close(),
        () => {},
      );
    canvas.width = 0;
    canvas.height = 0;
  }
}
