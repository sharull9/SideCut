import { yieldTask } from "./yield-task";
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
  StreamingLimiter,
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
  streamMaster?: boolean;
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
const streamsEnvelope = (clip: Clip) =>
  clip.duration.seconds > 300 &&
  clip.speed === 1 &&
  Number(clip.audio?.voiceIsolation ?? 0) === 0 &&
  effectsOf(clip, "audio").every((effect) => !effect.enabled);
const checkpoint = (signal?: AbortSignal) => async () => {
  signal?.throwIfAborted();
  await yieldTask();
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
  if ((range.end - range.start) * rate * 2 * 4 * Math.max(1, clip.speed) > 128 * 1024 * 1024)
    throw new Error(
      "Processed clip exceeds the 128 MiB PCM budget. Use a smaller range or render effects separately.",
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
    await yieldTask();
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
    (s) => needsProcessing(s.clip) && !streamsEnvelope(s.clip) && s.end > (options.start ?? 0),
  );
  if (
    segments.reduce((sum, s) => sum + (s.renderEnd - s.renderStart) * 48000 * 2 * 4, 0) >
    256 * 1024 * 1024
  )
    throw new Error(
      "Prepared effects exceed the 256 MiB PCM budget. Play a smaller range or disable some audio effects.",
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
      await yieldTask();
    }
    return meter.result();
  };
  const first = await measure(channels);
  const render = async (db: number) => {
    const output = channels.map((channel) =>
      Float32Array.from(channel, (sample) => sample * gain(db)),
    );
    await limit(output, rate, ceiling, 80, checkpoint(signal));
    return output;
  };
  const db = await masteringGain(
    first,
    target,
    ceiling,
    async (level) => (await measure(await render(level))).integratedLUFS,
  );
  return render(db);
}
async function masteringGain(
  first: MeasuredSound,
  target: number,
  ceiling: number,
  measure: (level: number) => Promise<number>,
) {
  const initial = Number.isFinite(first.integratedLUFS)
    ? clamp(target - first.integratedLUFS, -40, 30)
    : 0;
  let db = initial;
  if (first.truePeakDBTP + initial > ceiling) {
    const points: { db: number; lufs: number }[] = [];
    for (const extra of [0, 0.75, 1.5, 2.5]) {
      const level = Math.min(initial + extra, 30);
      points.push({ db: level, lufs: await measure(level) });
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
  return db;
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
    if (options.streamMaster || duration - (options.start ?? 0) > 300) {
      const raw = () =>
        mixTimelineAudio(project, reader, signal, sampleRate, blockFrames, duration, {
          ...options,
          master: false,
        });
      const pass = async function* (db: number) {
        const limiter = new StreamingLimiter(sampleRate, 2, project.settings.truePeakCeiling, 80);
        let position = 0;
        const encode = (values: Float32Array[]) => {
          const frames = values[0]!.length,
            data = new Float32Array(frames * 2);
          for (let c = 0; c < 2; c++) data.set(values[c]!, c * frames);
          const block = {
            data,
            frames,
            numberOfChannels: 2,
            sampleRate,
            timestamp: position / sampleRate,
          };
          position += frames;
          return block;
        };
        for await (const block of raw()) {
          signal.throwIfAborted();
          const channels = [
            block.data.subarray(0, block.frames),
            block.data.subarray(block.frames),
          ].map((channel) => Float32Array.from(channel, (value) => value * gain(db)));
          const output = limiter.push(channels);
          if (output[0]!.length) yield encode(output);
        }
        signal.throwIfAborted();
        const tail = limiter.finish();
        if (tail[0]!.length) yield encode(tail);
      };
      const measure = async (blocks: ReturnType<typeof raw> | ReturnType<typeof pass>) => {
        const meter = new LoudnessMeter(sampleRate, 2);
        for await (const block of blocks) {
          signal.throwIfAborted();
          meter.process([block.data.subarray(0, block.frames), block.data.subarray(block.frames)]);
        }
        return meter.result();
      };
      const first = await measure(raw());
      const level = await masteringGain(
        first,
        project.settings.loudnessTarget,
        project.settings.truePeakCeiling,
        async (db) => (await measure(pass(db))).integratedLUFS,
      );
      yield* pass(level);
      return;
    }
    const mixed = [
      new Float32Array(Math.ceil((duration - (options.start ?? 0)) * sampleRate)),
      new Float32Array(Math.ceil((duration - (options.start ?? 0)) * sampleRate)),
    ];
    let offset = 0;
    for await (const block of mixTimelineAudio(
      project,
      reader,
      signal,
      sampleRate,
      blockFrames,
      duration,
      { ...options, master: false, start: options.start ?? 0 },
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
      await yieldTask();
    }
    return;
  }
  const sources = audioSegments(project).map((segment) => ({
    segment,
    iterator: null as AsyncIterator<DecodedAudio> | null,
    current: null as DecodedAudio | null,
    done: false,
    processed: options.prepared?.get(segment.clip.id) ?? (null as Float32Array[] | null),
    envelope: null as ((time: number) => number) | null,
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
  const firstFrame = Math.max(0, Math.floor((options.start ?? 0) * sampleRate));
  const total = firstFrame + Math.ceil((duration - (options.start ?? 0)) * sampleRate);
  try {
    for (let first = firstFrame; first < total; first += blockFrames) {
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
        const processing = needsProcessing(clip) && !streamsEnvelope(clip);
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
        if (!source.envelope) {
          const measured =
            typeof clip.audio?.normalizeTo === "number"
              ? ((await options.measure?.(segment.mediaID))?.integratedLUFS ?? -Infinity)
              : -Infinity;
          if (typeof clip.audio?.normalizeTo === "number" && !options.measure)
            throw new Error("Measure source loudness before normalizing speech.");
          source.envelope = audioEnvelope(clip, measured);
        }
        source.iterator ??= (await reader(segment.mediaID)).audio(
          Math.max(
            segment.sourceStart,
            clip.sourceStart.seconds +
              (Math.max(start, segment.start) - clip.start.seconds) * clip.speed,
          ),
          Math.min(
            segment.sourceEnd,
            clip.sourceStart.seconds + (duration - clip.start.seconds) * clip.speed,
          ),
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
              microGain((first + index) / sampleRate) *
              source.envelope((first + index) / sampleRate - clip.start.seconds);
          }
        }
      }
      yield { data, sampleRate, numberOfChannels: 2, timestamp: start, frames: count };
      await yieldTask();
    }
  } finally {
    await Promise.all(sources.map((source) => source.iterator?.return?.()));
  }
}
