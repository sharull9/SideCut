// Ported from TandemMedia/LoudnessMeter.swift. Notice: tests/fixtures/tandem/TANDEM-LICENSE.
export interface MeasuredSound {
  integratedLUFS: number;
  truePeakDBTP: number;
  loudnessRange: number;
}
export const analysisVersion = "bs1770-4-v1";
export const peakCoefficients = (() => {
  const taps = Array.from({ length: 48 }, (_, n) => {
    const x = (n - 23.5) / 4;
    return (Math.sin(Math.PI * x) / (Math.PI * x)) * (0.5 - 0.5 * Math.cos((2 * Math.PI * n) / 47));
  });
  const scale = 4 / taps.reduce((a, b) => a + b, 0);
  return Array.from({ length: 4 }, (_, phase) =>
    Array.from({ length: 12 }, (_tap, i) => taps[phase + 4 * i]! * scale),
  );
})();
const mean = (values: readonly number[]) => values.reduce((a, b) => a + b, 0) / values.length;
const lufs = (energy: number) => (energy > 0 ? -0.691 + 10 * Math.log10(energy) : -Infinity);
function filter(coefficients: number[]) {
  let x1 = 0,
    x2 = 0,
    y1 = 0,
    y2 = 0;
  return (x: number) => {
    const [b0, b1, b2, a1, a2] = coefficients as [number, number, number, number, number];
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    return y;
  };
}
export class LoudnessMeter {
  private readonly filters;
  private readonly history: number[][];
  private readonly energies: number[] = [];
  private fill = 0;
  private sum = 0;
  private peak = 0;
  private position = 0;
  constructor(
    readonly sampleRate = 48000,
    readonly channels = 2,
  ) {
    if (!(sampleRate >= 8000) || !Number.isInteger(channels) || channels < 1)
      throw new Error("Loudness measurement requires at least 8 kHz and one channel.");
    const k = Math.tan((Math.PI * 1681.974450955533) / sampleRate),
      vh = 10 ** (3.999843853973347 / 20),
      vb = vh ** 0.4996667741545416,
      q = 0.7071752369554196,
      a = 1 + k / q + k * k,
      h = Math.tan((Math.PI * 38.13547087602444) / sampleRate),
      b = 1 + h / 0.5003270373238773 + h * h;
    this.filters = Array.from({ length: channels }, () => [
      filter([
        (vh + (vb * k) / q + k * k) / a,
        (2 * (k * k - vh)) / a,
        (vh - (vb * k) / q + k * k) / a,
        (2 * (k * k - 1)) / a,
        (1 - k / q + k * k) / a,
      ]),
      filter([1, -2, 1, (2 * (h * h - 1)) / b, (1 - h / 0.5003270373238773 + h * h) / b]),
    ]);
    this.history = Array.from({ length: channels }, () => Array<number>(12).fill(0));
  }
  process(planar: readonly Float32Array[]) {
    if (planar.length !== this.channels || planar.some((p) => p.length !== planar[0]!.length))
      throw new Error("Loudness channel buffers must have equal lengths.");
    for (let i = 0; i < planar[0]!.length; i++) {
      for (let c = 0; c < this.channels; c++) {
        const x = planar[c]![i]!;
        if (!Number.isFinite(x)) throw new Error("Audio contains a non-finite sample.");
        const history = this.history[c]!;
        history[this.position] = x;
        this.peak = Math.max(this.peak, Math.abs(x));
        for (const phase of peakCoefficients) {
          let value = 0;
          for (let j = 0; j < 12; j++) value += phase[j]! * history[(this.position - j + 12) % 12]!;
          this.peak = Math.max(this.peak, Math.abs(value));
        }
        const y = this.filters[c]![1]!(this.filters[c]![0]!(x));
        const weight = this.channels === 6 ? [1, 1, 1, 0, 1.41, 1.41][c]! : 1;
        this.sum += y * y * weight;
      }
      this.position = (this.position + 1) % 12;
      if (++this.fill === Math.round(this.sampleRate * 0.1)) {
        this.energies.push(this.sum / this.fill);
        this.fill = 0;
        this.sum = 0;
      }
    }
  }
  result(): MeasuredSound {
    const windows = (count: number) => {
      const result: number[] = [];
      let sum = 0;
      for (let i = 0; i < this.energies.length; i++) {
        sum += this.energies[i]!;
        if (i >= count) sum -= this.energies[i - count]!;
        if (i >= count - 1) result.push(Math.max(0, sum) / count);
      }
      return result;
    };
    const absolute = windows(4).filter((e) => lufs(e) > -70),
      gated = absolute.filter((e) => lufs(e) > lufs(mean(absolute)) - 10),
      short = windows(30).filter((e) => lufs(e) > -70),
      range = short
        .filter((e) => lufs(e) > lufs(mean(short)) - 20)
        .map(lufs)
        .sort((a, b) => a - b);
    return {
      integratedLUFS: gated.length ? lufs(mean(gated)) : -Infinity,
      truePeakDBTP: this.peak > 0 ? 20 * Math.log10(this.peak) : -Infinity,
      loudnessRange:
        range.length > 1
          ? range[Math.round(0.95 * (range.length - 1))]! -
            range[Math.round(0.1 * (range.length - 1))]!
          : 0,
    };
  }
}
