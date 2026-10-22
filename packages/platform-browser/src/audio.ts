import type { Project } from "@sidecut/contracts/project";
import { audioSegments } from "@sidecut/core/audio-plan";
import { projectDuration } from "@sidecut/core/render-plan";
import type { LocalMediaReader } from "./preview";
interface DecodedAudio {
  timestamp: number;
  duration: number;
  buffer: AudioBuffer;
}
// A bounded stereo block mixer; separate clip iterators retain their own source offsets.
export async function* mixTimelineAudio(
  project: Project,
  reader: (id: string) => Promise<Pick<LocalMediaReader, "audio">>,
  signal: AbortSignal,
  sampleRate = 48000,
  blockFrames = 4096,
  duration = projectDuration(project).seconds,
) {
  const sources = audioSegments(project).map((segment) => ({
    segment,
    iterator: null as AsyncIterator<DecodedAudio> | null,
    current: null as DecodedAudio | null,
    done: false,
  }));
  const total = Math.ceil(duration * sampleRate);
  try {
    for (let first = 0; first < total; first += blockFrames) {
      signal.throwIfAborted();
      const count = Math.min(blockFrames, total - first),
        start = first / sampleRate,
        stop = (first + count) / sampleRate,
        data = new Float32Array(count * 2);
      for (const source of sources) {
        const segment = source.segment;
        if (source.done || segment.start >= stop || segment.end <= start) continue;
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
          if (!current || time < current.timestamp) continue;
          const position = Math.max(0, (time - current.timestamp) * current.buffer.sampleRate),
            i = Math.min(current.buffer.length - 1, Math.floor(position)),
            fraction = position - i;
          for (let channel = 0; channel < 2; channel++) {
            const values = current.buffer.getChannelData(
              Math.min(channel, current.buffer.numberOfChannels - 1),
            );
            data[channel * count + index]! +=
              values[i]! * (1 - fraction) + values[Math.min(i + 1, values.length - 1)]! * fraction;
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
