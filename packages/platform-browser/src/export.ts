import { paintPicture } from "./picture";
import type { Project, Clip } from "@sidecut/contracts/project";
import { enabledTracks, audioRange, exportPlan } from "@sidecut/core/render-plan";
import type { LocalResource } from "./storage";
import { LocalMediaReader } from "./preview";

export async function renderWebM(
  project: Project,
  resource: (id: string) => Promise<LocalResource | null>,
  externalSignal: AbortSignal,
  onProgress: (progress: number) => void,
): Promise<Blob> {
  const work = new AbortController();
  const signal = AbortSignal.any([externalSignal, work.signal]);
  const plan = exportPlan(project);
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
    signal.throwIfAborted();
    await output.start();
    const picture = async () => {
      const count = plan.frameCount;
      for (let index = 0; index < count; index++) {
        signal.throwIfAborted();
        const time = index / plan.fps;
        await paintPicture(ctx, project, time, reader, signal);
        await video.add(time, 1 / plan.fps);
        onProgress(((index + 1) / count) * 0.95);
        if (index % 3 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
      }
      video.close();
    };
    const sound = async () => {
      if (!audio) return;
      for (const track of project.audioTracks) {
        if (track.muted || (project.audioTracks.some((t) => t.solo) && !track.solo)) continue;
        for (const clip of track.clips) {
          if (!clip.enabled || clip.audio?.muted === true) continue;
          const range = audioRange(project, clip);
          if (!range) continue;
          const { from, to } = range;
          const buffers = (await reader(id(clip))).audio(from, to);
          try {
            for await (const item of buffers) {
              signal.throwIfAborted();
              const start = Math.max(from, item.timestamp),
                stop = Math.min(to, item.timestamp + item.duration);
              const first = Math.max(
                  0,
                  Math.round((start - item.timestamp) * item.buffer.sampleRate),
                ),
                last = Math.min(
                  item.buffer.length,
                  Math.round((stop - item.timestamp) * item.buffer.sampleRate),
                );
              if (last <= first) continue;
              const channels = item.buffer.numberOfChannels,
                data = new Float32Array((last - first) * channels);
              for (let channel = 0; channel < channels; channel++)
                data.set(
                  item.buffer.getChannelData(channel).subarray(first, last),
                  channel * (last - first),
                );
              const sample = new AudioSample({
                data,
                format: "f32-planar",
                numberOfChannels: channels,
                sampleRate: item.buffer.sampleRate,
                timestamp: clip.start.seconds + start - clip.sourceStart.seconds,
              });
              try {
                await audio.add(sample);
              } finally {
                sample.close();
              }
            }
          } finally {
            await buffers.return();
          }
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
