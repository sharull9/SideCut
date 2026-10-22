import type { Project } from "@sidecut/contracts/project";
import { audioSegments, seamlessAudio } from "@sidecut/core/audio-plan";
import { projectDuration } from "@sidecut/core/render-plan";
import type { LocalMediaReader } from "./preview";
import type { Clip } from "@sidecut/contracts/project";
import type { MeasuredSound } from "@sidecut/core/loudness";
import { LoudnessMeter } from "@sidecut/core/loudness";
import {
  audioEnvelope,
  audioParams,
  compress,
  limit,
  normalizeGain,
  pitchAndSpeed,
  gain,
  clamp,
} from "@sidecut/core/audio-processing";
import { effectsOf } from "@sidecut/core/effect-editing";
import { Time } from "@sidecut/contracts/time";
import { isolateVoice } from "./voice-isolation";
import { cleanVoice } from "@sidecut/core/audio-processing";
interface DecodedAudio {
  timestamp: number;
  duration: number;
  buffer: AudioBuffer;
}
interface MixOptions {
  onProgress?: (value: number) => void;
  measure?: (id: string) => Promise<MeasuredSound>;
  start?: number;
  master?: boolean;
  prepared?: ReadonlyMap<string, Float32Array[]>;
}
const needsProcessing = (clip: Clip) =>
  Boolean(
    clip.speed !== 1 ||
    clip.keyframes["audio.gainDB"]?.length ||
    Object.entries(clip.audio ?? {}).some(([key, value]) =>
      ["gainDB", "fadeIn", "fadeOut", "voiceIsolation"].includes(key)
        ? value !== 0
        : key === "normalizeTo"
          ? value != null
          : key === "effects" && Array.isArray(value) && value.some((fx) => fx.enabled !== false),
    ),
  );
const checkpoint = (signal?: AbortSignal) => async () => {
  signal?.throwIfAborted();
  await new Promise((resolve) => setTimeout(resolve, 0));
  signal?.throwIfAborted();
};
async function processedClip(
  clip: Clip,
  mediaID: string,
  reader: Pick<LocalMediaReader, "audio">,
  signal: AbortSignal,
  rate: number,
  options: MixOptions,
  range = { start: clip.start.seconds, end: clip.start.seconds + clip.duration.seconds },
) {
  if (clip.duration.seconds > 300 || clip.duration.seconds * clip.speed > 600)
    throw new Error(
      "Processed browser audio supports clips up to five minutes and source spans up to ten minutes.",
    );
  const offset = range.start - clip.start.seconds,
    renderClip = {
      ...clip,
      start: Time.fromSeconds(range.start),
      duration: Time.fromSeconds(range.end - range.start),
      sourceStart: Time.fromSeconds(clip.sourceStart.seconds + offset * clip.speed),
      keyframes: Object.fromEntries(
        Object.entries(clip.keyframes).map(([key, list]) => [
          key,
          list.map((k) => ({ ...k, time: Number(k.time) - offset })),
        ]),
      ),
    };
  const count = Math.ceil(renderClip.duration.seconds * clip.speed * rate),
    input = [new Float32Array(count), new Float32Array(count)],
    start = renderClip.sourceStart.seconds;
  for await (const item of reader.audio(Math.max(0, start), Math.max(0, start + count / rate))) {
    signal.throwIfAborted();
    const from = Math.max(0, Math.ceil((item.timestamp - start) * rate - 1e-7)),
      to = Math.min(count, Math.ceil((item.timestamp + item.duration - start) * rate - 1e-7));
    for (let c = 0; c < 2; c++) {
      const values = item.buffer.getChannelData(Math.min(c, item.buffer.numberOfChannels - 1));
      for (let i = from; i < to; i++) {
        const position = (start + i / rate - item.timestamp) * item.buffer.sampleRate,
          j = Math.max(0, Math.floor(position)),
          f = position - j;
        input[c]![i] = (values[j] ?? 0) * (1 - f) + (values[j + 1] ?? values[j] ?? 0) * f;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  let measured = -Infinity;
  if (typeof clip.audio?.normalizeTo === "number") {
    if (!options.measure) throw new Error(`Measure source ${mediaID} before speech levelling.`);
    measured = (await options.measure(mediaID)).integratedLUFS;
  }
  signal.throwIfAborted();
  const isolation = clamp(Number(clip.audio?.voiceIsolation ?? 0), 0, 1);
  let wet: Float32Array[] | undefined;
  if (isolation > 0) {
    if (rate !== 48000) throw new Error("Voice isolation requires 48 kHz audio.");
    wet = await isolateVoice(input, signal, options.onProgress);
  }
  const normalization =
      typeof clip.audio?.normalizeTo === "number"
        ? normalizeGain(clip.audio.normalizeTo, measured)
        : 0,
    lift = 10 ** (clamp(Number(clip.audio?.gainDB ?? 0) + normalization, -120, 150) / 20);
  const process = async (channels: Float32Array[]) => {
    const output = await pitchAndSpeed(channels, rate, renderClip, 0, checkpoint(signal));
    for (const channel of output) for (let i = 0; i < channel.length; i++) channel[i]! *= lift;
    for (const fx of effectsOf(clip, "audio").filter((effect) => effect.enabled)) {
      const params = audioParams(fx);
      if (fx.type === "compressor") await compress(output, rate, params, checkpoint(signal));
      if (fx.type === "voiceCleanup") await cleanVoice(output, rate, params, checkpoint(signal));
      if (fx.type === "limiter")
        await limit(output, rate, params.ceiling, params.release, checkpoint(signal));
      signal.throwIfAborted();
    }
    return output;
  };
  // Tandem runs dynamics on each source, then weights the resulting dry/wet segments.
  const output = await process(isolation === 1 ? wet! : input);
  if (wet && isolation < 1) {
    const isolated = await process(wet);
    for (let c = 0; c < output.length; c++)
      for (let i = 0; i < output[c]!.length; i++)
        output[c]![i] = output[c]![i]! * (1 - isolation) + isolated[c]![i]! * isolation;
  }
  const envelopeAt = audioEnvelope(clip, measured);
  for (let i = 0; i < output[0]!.length; i++) {
    if (i % 32768 === 0) await checkpoint(signal)();
    const envelope = envelopeAt(i / rate + offset) / lift;
    for (const channel of output) channel[i]! *= envelope;
  }
  return output;
}
// Prepare expensive clip processors before starting the playback clock, including later clips.
export async function prepareTimelineAudio(
  project: Project,
  reader: (id: string) => Promise<Pick<LocalMediaReader, "audio">>,
  signal: AbortSignal,
  options: MixOptions = {},
) {
  const segments = audioSegments(project).filter(
    (s) => needsProcessing(s.clip) && s.end > (options.start ?? 0),
  );
  if (segments.reduce((sum, s) => sum + s.clip.duration.seconds, 0) > 600)
    throw new Error(
      "Processed preview supports up to ten minutes of combined audio clips. Shorten the sequence or disable some audio tracks.",
    );
  const result = new Map<string, Float32Array[]>();
  for (const segment of segments) {
    signal.throwIfAborted();
    result.set(
      segment.clip.id,
      await processedClip(
        segment.clip,
        segment.mediaID,
        await reader(segment.mediaID),
        signal,
        48000,
        {
          ...options,
          onProgress: (value) => options.onProgress?.((result.size + value) / segments.length),
        },
        { start: segment.renderStart, end: segment.renderEnd },
      ),
    );
    options.onProgress?.(result.size / segments.length);
  }
  return result;
}

export async function masterAudio(
  channels: Float32Array[],
  rate: number,
  target: number,
  ceiling: number,
  signal?: AbortSignal,
) {
  const measure = async (values: Float32Array[]) => {
    const meter = new LoudnessMeter(rate, values.length);
    for (let i = 0; i < values[0]!.length; i += 32768) {
      signal?.throwIfAborted();
      meter.process(values.map((p) => p.subarray(i, i + 32768)));
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    return meter.result();
  };
  const first = await measure(channels);
  const initial = Number.isFinite(first.integratedLUFS)
    ? clamp(target - first.integratedLUFS, -40, 30)
    : 0;
  const render = async (db: number) => {
    const output = channels.map((channel) =>
      Float32Array.from(channel, (sample) => sample * gain(db)),
    );
    await limit(output, rate, ceiling, 80, checkpoint(signal));
    return output;
  };
  let db = initial;
  if (first.truePeakDBTP + initial > ceiling) {
    const points: { db: number; lufs: number }[] = [];
    for (const extra of [0, 0.75, 1.5, 2.5]) {
      const level = Math.min(initial + extra, 30),
        output = await render(level);
      points.push({ db: level, lufs: (await measure(output)).integratedLUFS });
    }
    const below = points.filter((p) => p.lufs <= target).at(-1),
      above = points.find((p) => p.lufs >= target);
    if (below && above) {
      db =
        above.lufs - below.lufs > 1e-9
          ? below.db + ((above.db - below.db) * (target - below.lufs)) / (above.lufs - below.lufs)
          : below.db;
    } else {
      const low = target < points[0]!.lufs;
      const a = points[low ? 0 : points.length - 2]!,
        b = points[low ? 1 : points.length - 1]!;
      const slope = clamp((b.lufs - a.lufs) / Math.max(b.db - a.db, 1e-9), 0.3, 1.2);
      const anchor = low ? a : b;
      db = anchor.db + (target - anchor.lufs) / slope;
    }
    db = clamp(db, -40, 30);
  }
  return render(db);
}
// A bounded stereo block mixer; separate clip iterators retain their own source offsets.
export async function* mixTimelineAudio(
  project: Project,
  reader: (id: string) => Promise<Pick<LocalMediaReader, "audio">>,
  signal: AbortSignal,
  sampleRate = 48000,
  blockFrames = 4096,
  duration = projectDuration(project).seconds,
  options: MixOptions = {},
) {
  if (options.master) {
    if (duration > 300) throw new Error("Browser mastering supports sequences up to five minutes.");
    const mixed = [
      new Float32Array(Math.ceil(duration * sampleRate)),
      new Float32Array(Math.ceil(duration * sampleRate)),
    ];
    let offset = 0;
    for await (const block of mixTimelineAudio(
      project,
      reader,
      signal,
      sampleRate,
      blockFrames,
      duration,
      { ...options, master: false, start: 0 },
    )) {
      for (let c = 0; c < 2; c++)
        mixed[c]!.set(block.data.subarray(c * block.frames, (c + 1) * block.frames), offset);
      offset += block.frames;
    }
    signal.throwIfAborted();
    const mastered = await masterAudio(
      mixed,
      sampleRate,
      project.settings.loudnessTarget,
      project.settings.truePeakCeiling,
      signal,
    );
    for (let first = 0; first < mastered[0]!.length; first += blockFrames) {
      signal.throwIfAborted();
      const frames = Math.min(blockFrames, mastered[0]!.length - first),
        data = new Float32Array(frames * 2);
      for (let c = 0; c < 2; c++)
        data.set(mastered[c]!.subarray(first, first + frames), c * frames);
      yield { data, sampleRate, numberOfChannels: 2, timestamp: first / sampleRate, frames };
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    return;
  }
  const sources = audioSegments(project).map((segment) => ({
    segment,
    iterator: null as AsyncIterator<DecodedAudio> | null,
    current: null as DecodedAudio | null,
    done: false,
    processed: options.prepared?.get(segment.clip.id) ?? (null as Float32Array[] | null),
    microIn:
      !project.audioTracks
        .find((t) => t.id === segment.trackID)!
        .clips.some((c) => seamlessAudio(c, segment.clip)) &&
      Number(segment.clip.audio?.fadeIn ?? 0) < 0.003 &&
      !segment.headWindow,
    microOut:
      !project.audioTracks
        .find((t) => t.id === segment.trackID)!
        .clips.some((c) => seamlessAudio(segment.clip, c)) &&
      Number(segment.clip.audio?.fadeOut ?? 0) < 0.003 &&
      !segment.tailWindow,
  }));
  const total = Math.ceil(duration * sampleRate);
  try {
    for (
      let first = Math.max(0, Math.floor((options.start ?? 0) * sampleRate));
      first < total;
      first += blockFrames
    ) {
      signal.throwIfAborted();
      const count = Math.min(blockFrames, total - first),
        start = first / sampleRate,
        stop = (first + count) / sampleRate,
        data = new Float32Array(count * 2);
      for (const source of sources) {
        const segment = source.segment;
        const microGain = (time: number) =>
          (source.microIn ? clamp((time - segment.clip.start.seconds) / 0.003, 0, 1) : 1) *
          (source.microOut
            ? clamp(
                (segment.clip.start.seconds + segment.clip.duration.seconds - time) / 0.003,
                0,
                1,
              )
            : 1) *
          (segment.headWindow
            ? Math.sin(
                (Math.PI / 2) *
                  clamp((time - segment.headWindow.start) / segment.headWindow.duration, 0, 1),
              )
            : 1) *
          (segment.tailWindow
            ? Math.sin(
                (Math.PI / 2) *
                  clamp((segment.tailWindow.end - time) / segment.tailWindow.duration, 0, 1),
              )
            : 1);
        if (segment.end <= start) {
          source.processed = null;
          continue;
        }
        if (source.done || segment.start >= stop) continue;
        const clip = segment.clip;
        const processing = needsProcessing(clip);
        if (processing) {
          source.processed ??= await processedClip(
            clip,
            segment.mediaID,
            await reader(segment.mediaID),
            signal,
            sampleRate,
            options,
            { start: segment.renderStart, end: segment.renderEnd },
          );
          for (let i = 0; i < count; i++) {
            const time = (first + i) / sampleRate;
            if (time < segment.start || time >= segment.end) continue;
            const index = Math.round((time - segment.renderStart) * sampleRate);
            for (let c = 0; c < 2; c++)
              data[c * count + i]! += (source.processed[c]![index] ?? 0) * microGain(time);
          }
          continue;
        }
        source.iterator ??= (await reader(segment.mediaID)).audio(
          segment.sourceStart,
          segment.sourceEnd,
        );
        const from = Math.max(0, Math.ceil((segment.start - start) * sampleRate - 1e-7)),
          to = Math.min(count, Math.ceil((segment.end - start) * sampleRate - 1e-7));
        for (let index = from; index < to; index++) {
          const time =
            segment.clip.sourceStart.seconds +
            ((first + index) / sampleRate - segment.clip.start.seconds) * segment.clip.speed;
          while (
            !source.done &&
            (!source.current || time >= source.current.timestamp + source.current.duration - 1e-9)
          ) {
            signal.throwIfAborted();
            const next = await source.iterator.next();
            source.done = next.done ?? false;
            source.current = next.done ? null : next.value;
          }
          const current = source.current;
          // Decoder timestamps may round just above the exact sample clock.
          if (!current || time < current.timestamp - 1e-9) continue;
          const position = Math.max(0, (time - current.timestamp) * current.buffer.sampleRate),
            i = Math.min(current.buffer.length - 1, Math.floor(position)),
            fraction = position - i;
          for (let channel = 0; channel < 2; channel++) {
            const values = current.buffer.getChannelData(
              Math.min(channel, current.buffer.numberOfChannels - 1),
            );
            data[channel * count + index]! +=
              (values[i]! * (1 - fraction) +
                values[Math.min(i + 1, values.length - 1)]! * fraction) *
              microGain((first + index) / sampleRate);
          }
        }
      }
      yield { data, sampleRate, numberOfChannels: 2, timestamp: start, frames: count };
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  } finally {
    await Promise.all(sources.map((source) => source.iterator?.return?.()));
  }
}
