import { Schema } from "effect";
const range = (min: number, max: number) =>
  Schema.Finite.check(Schema.isGreaterThanOrEqualTo(min), Schema.isLessThanOrEqualTo(max));
export const LiveAudioSettingsSchema = Schema.Struct({
  gainDB: range(-96, 12),
  muted: Schema.Boolean,
  monitor: Schema.Boolean,
  syncOffsetMs: range(0, 2000),
  cleanup: Schema.Literals(["off", "rumble"]),
});
export type LiveAudioSettings = typeof LiveAudioSettingsSchema.Type;
export const DEFAULT_LIVE_AUDIO: LiveAudioSettings = {
  gainDB: 0,
  muted: false,
  monitor: false,
  syncOffsetMs: 0,
  cleanup: "off",
};
export const liveAudioSettings = (input: unknown) =>
  Schema.decodeUnknownSync(LiveAudioSettingsSchema)(input);
export function liveMeter(samples: Float32Array) {
  let peak = 0,
    energy = 0;
  for (const sample of samples) {
    if (!Number.isFinite(sample)) throw new Error("Invalid meter sample.");
    peak = Math.max(peak, Math.abs(sample));
    energy += sample * sample;
  }
  const rms = samples.length ? Math.sqrt(energy / samples.length) : 0;
  return {
    peak,
    rms,
    peakDB: peak ? 20 * Math.log10(peak) : -Infinity,
    rmsDB: rms ? 20 * Math.log10(rms) : -Infinity,
    clipped: peak >= 1,
  };
}
