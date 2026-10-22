// Based on TandemRender audio processing. Notice: tests/fixtures/tandem/TANDEM-LICENSE.
import type { Clip, ClipEffect } from "@sidecut/contracts/project";
import { effectsOf } from "./effect-editing";
import { resolvedParams, effectDefinition } from "./effects";
import { keyframeValue } from "./keyframes";
import { peakCoefficients } from "./loudness";

export const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));
export const gain = (db: number) => (db <= -96 ? 0 : 10 ** (db / 20));
export const normalizeGain = (target: number, measured: number) =>
  Number.isFinite(measured) ? clamp(target - measured, -30, 30) : 0;
const equalPower = (p: number) => Math.sin((Math.PI / 2) * clamp(p, 0, 1));
export function audioGain(clip: Clip, localTime: number, measured = -Infinity) {
  const audio = clip.audio ?? {};
  const frames = clip.keyframes["audio.gainDB"];
  const db = frames?.length ? keyframeValue(frames, localTime) : (audio.gainDB ?? 0);
  const normalization =
    typeof audio.normalizeTo === "number" ? normalizeGain(audio.normalizeTo, measured) : 0;
  let value = gain(Number(db)) * gain(normalization);
  const fadeIn = Number(audio.fadeIn ?? 0),
    fadeOut = Number(audio.fadeOut ?? 0);
  if (fadeIn > 0) value *= equalPower(localTime / fadeIn);
  if (fadeOut > 0) value *= equalPower((clip.duration.seconds - localTime) / fadeOut);
  return value;
}
export function audioEnvelope(clip: Clip, measured = -Infinity) {
  const times = new Set([0, clip.duration.seconds]);
  const add = (time: number) => {
    if (time >= 0 && time <= clip.duration.seconds) times.add(time);
  };
  const subdivide = (start: number, length: number, pieces: number) => {
    for (let i = 0; i <= pieces; i++) add(start + (length * i) / pieces);
  };
  const frames = [...(clip.keyframes["audio.gainDB"] ?? [])].sort(
    (a, b) => Number(a.time) - Number(b.time),
  );
  for (let i = 0; i < frames.length; i++) {
    const time = Number(frames[i]!.time);
    add(time);
    if (i > 0) {
      const start = Number(frames[i - 1]!.time),
        length = time - start;
      subdivide(start, length, clamp(Math.ceil(length / 0.05), 1, 24));
    }
  }
  if (Number(clip.audio?.fadeIn ?? 0) > 0) subdivide(0, Number(clip.audio!.fadeIn), 8);
  if (Number(clip.audio?.fadeOut ?? 0) > 0)
    subdivide(clip.duration.seconds - Number(clip.audio!.fadeOut), Number(clip.audio!.fadeOut), 8);
  const points = [...times]
    .sort((a, b) => a - b)
    .map((time) => ({ time, gain: audioGain(clip, time, measured) }));
  let index = 0;
  return (time: number) => {
    while (index + 1 < points.length - 1 && points[index + 1]!.time <= time) index++;
    while (index > 0 && points[index]!.time > time) index--;
    const a = points[index]!,
      b = points[index + 1]!;
    return a.gain + (b.gain - a.gain) * clamp((time - a.time) / (b.time - a.time), 0, 1);
  };
}
export function audioEffectIssue(clip: Clip): string | null {
  const gains = [
    Number(clip.audio?.gainDB ?? 0),
    ...(clip.keyframes["audio.gainDB"] ?? []).map((key) => Number(key.value)),
  ];
  if (gains.some((db) => !Number.isFinite(db) || db > 120))
    return "Browser audio gain must be finite and no higher than 120 dB.";
  for (const effect of effectsOf(clip, "audio"))
    if (effect.enabled && !["pitchShift", "compressor", "limiter"].includes(effect.type))
      return `Audio effect ${effect.type} is not available in this browser renderer.`;
  if (Number(clip.audio?.voiceIsolation ?? 0) !== 0) return "Voice isolation is not available yet.";
  if (Number(clip.audio?.pan ?? 0) !== 0) return "Audio panning is not available yet.";
  return null;
}
export function audioParams(effect: ClipEffect) {
  const params = resolvedParams(effect);
  return Object.fromEntries(
    effectDefinition(effect.type)!.params.map((p) => [
      p.key,
      clamp(Number(params[p.key]), p.min ?? -Infinity, p.max ?? Infinity),
    ]),
  );
}
export async function compress(
  channels: Float32Array[],
  rate: number,
  params: Record<string, number>,
  checkpoint?: () => Promise<void>,
) {
  const { threshold = -14, ratio = 3, knee = 6, makeup = 0, attack = 10, release = 200 } = params;
  const detector = 1 - Math.exp(-1 / (0.01 * rate)),
    down = 1 - Math.exp(-1 / (attack * 0.001 * rate)),
    up = 1 - Math.exp(-1 / (release * 0.001 * rate));
  let energy = 0,
    reduction = 0;
  for (let i = 0; i < channels[0]!.length; i++) {
    if (i % 32768 === 0) {
      await checkpoint?.();
    }
    let loudest = 0;
    for (const channel of channels) loudest = Math.max(loudest, channel[i]! ** 2);
    energy += detector * (loudest - energy);
    const over = 10 * Math.log10(energy + 1e-20) - threshold,
      slope = 1 / ratio - 1;
    const target =
      2 * over < -knee
        ? 0
        : knee > 0 && 2 * Math.abs(over) <= knee
          ? (slope * (over + knee / 2) ** 2) / (2 * knee)
          : slope * over;
    reduction += (target < reduction ? down : up) * (target - reduction);
    const level = gain(reduction + makeup);
    for (const channel of channels) channel[i]! *= level;
  }
}
// Full-buffer form of Tandem's delayed limiter; lookahead compensation preserves sample positions.
export async function limit(
  channels: Float32Array[],
  rate: number,
  ceilingDB = -1,
  releaseMS = 100,
  checkpoint?: () => Promise<void>,
) {
  const ceiling = gain(ceilingDB - 0.1),
    lookahead = Math.max(1, Math.round(rate * 0.005)),
    latency = lookahead + 6,
    history = channels.map(() => new Float64Array(12)),
    held = new Float64Array(lookahead + 1).fill(1),
    delay = channels.map(() => new Float32Array(latency)),
    release = 1 - Math.exp(-1 / (releaseMS * 0.001 * rate));
  let heldSum = held.length,
    reduction = 1,
    head = 0;
  const queue: { index: number; gain: number }[] = [];
  const frames = channels[0]!.length;
  for (let i = 0; i < frames + latency; i++) {
    if (i % 32768 === 0) {
      await checkpoint?.();
    }
    let peak = 0;
    for (let c = 0; c < channels.length; c++) {
      const h = history[c]!;
      h[i % 12] = i < frames ? channels[c]![i]! : 0;
      for (const phase of peakCoefficients) {
        let value = 0;
        for (let j = 0; j < 12; j++) value += phase[j]! * h[(i - j + 12) % 12]!;
        peak = Math.max(peak, Math.abs(value));
      }
      peak = Math.max(peak, Math.abs(h[(i - 6 + 12) % 12]!));
    }
    const required = peak > ceiling ? ceiling / peak : 1;
    while (queue.length > head && queue.at(-1)!.gain >= required) queue.pop();
    queue.push({ index: i, gain: required });
    while (queue[head]!.index <= i - lookahead - 2) head++;
    const minimum = queue[head]!.gain;
    heldSum += minimum - held[i % held.length]!;
    held[i % held.length] = minimum;
    const smoothed = Math.min(1, heldSum / held.length);
    reduction = smoothed < reduction ? smoothed : reduction + (smoothed - reduction) * release;
    for (let c = 0; c < channels.length; c++) {
      const line = delay[c]!,
        input = i < frames ? channels[c]![i]! : 0,
        output = line[i % latency]! * reduction;
      line[i % latency] = input;
      if (i >= latency) channels[c]![i - latency] = output;
    }
    if (head > 1024) {
      queue.splice(0, head);
      head = 0;
    }
  }
}
// Portable granular time/pitch conversion. Apple TimePitch uses a different algorithm.
export async function pitchAndSpeed(
  input: readonly Float32Array[],
  rate: number,
  clip: Clip,
  sourceOffset = 0,
  checkpoint?: () => Promise<void>,
) {
  const count = Math.ceil(clip.duration.seconds * rate),
    output = input.map(() => new Float32Array(count)),
    shifts = effectsOf(clip, "audio")
      .filter(
        (fx) =>
          fx.enabled &&
          fx.type === "pitchShift" &&
          (Number(resolvedParams(fx).semitones) !== 0 ||
            clip.keyframes[`audio.effects.${fx.id}.semitones`]?.length),
      )
      .slice(0, 1);
  const pitch = (time: number) =>
    2 **
    (shifts.reduce((sum, fx) => {
      const list = clip.keyframes[`audio.effects.${fx.id}.semitones`];
      const value = list?.length
        ? Number(keyframeValue(list, time))
        : Number(resolvedParams(fx).semitones);
      return sum + clamp(value, -24, 24);
    }, 0) /
      12);
  const sample = (values: Float32Array, position: number) => {
    if (position < 0 || position >= values.length) return 0;
    const i = Math.floor(position),
      f = position - i;
    return values[i]! * (1 - f) + (values[i + 1] ?? values[i]!) * f;
  };
  if (clip.speed === 1 && shifts.length === 0) {
    for (let c = 0; c < input.length; c++)
      for (let i = 0; i < count; i++) output[c]![i] = sample(input[c]!, i + sourceOffset);
    return output;
  }
  const width = Math.round(rate * 0.08),
    hop = Math.max(1, Math.round(width / 4)),
    weights = new Float32Array(count);
  for (let center = -hop; center < count + width / 2; center += hop) {
    if ((center + hop) % (hop * 32) === 0) {
      await checkpoint?.();
    }
    const factor = pitch(Math.max(0, center / rate));
    for (let j = -Math.floor(width / 2); j < width / 2; j++) {
      const i = center + j;
      if (i < 0 || i >= count) continue;
      const weight = 0.5 + 0.5 * Math.cos((2 * Math.PI * j) / width);
      weights[i]! += weight;
      const position = sourceOffset + center * clip.speed + j * factor;
      for (let c = 0; c < input.length; c++) output[c]![i]! += sample(input[c]!, position) * weight;
    }
  }
  for (const channel of output)
    for (let i = 0; i < count; i++) channel[i]! /= Math.max(1e-8, weights[i]!);
  return output;
}
