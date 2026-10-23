// GCC-PHAT based on TandemMedia/SoundSync.swift. See tests/fixtures/tandem/TANDEM-LICENSE.
function fft(real: Float64Array, imag: Float64Array, inverse = false) {
  const n = real.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [real[i], real[j]] = [real[j]!, real[i]!];
      [imag[i], imag[j]] = [imag[j]!, imag[i]!];
    }
  }
  for (let size = 2; size <= n; size *= 2) {
    const angle = ((inverse ? 2 : -2) * Math.PI) / size;
    const wr = Math.cos(angle),
      wi = Math.sin(angle);
    for (let start = 0; start < n; start += size) {
      let re = 1,
        im = 0;
      for (let j = 0; j < size / 2; j++) {
        const a = start + j,
          b = a + size / 2;
        const tr = re * real[b]! - im * imag[b]!,
          ti = re * imag[b]! + im * real[b]!;
        real[b] = real[a]! - tr;
        imag[b] = imag[a]! - ti;
        real[a] = real[a]! + tr;
        imag[a] = imag[a]! + ti;
        const next = re * wr - im * wi;
        im = re * wi + im * wr;
        re = next;
      }
    }
  }
  if (inverse)
    for (let i = 0; i < n; i++) {
      real[i] = real[i]! / n;
      imag[i] = imag[i]! / n;
    }
}

export interface SoundMatch {
  /** File time = reference time + offset. File starts earlier when positive. */
  offset: number;
  confidence: number;
  overlapStart: number;
  overlapEnd: number;
}
export function correlateSound(
  a: Float32Array,
  b: Float32Array,
  rate: number,
  low = 100,
  high = 3500,
  near?: number,
): SoundMatch {
  if (
    !Number.isFinite(rate) ||
    rate < 2000 ||
    a.length < rate ||
    b.length < rate ||
    a.length + b.length > 2_000_000
  )
    throw new Error(
      "Sync needs at least one second of sound per file and at most 120 seconds at 8 kHz per pair.",
    );
  let n = 1;
  while (n < a.length + b.length) n *= 2;
  const ar = new Float64Array(n),
    ai = new Float64Array(n),
    br = new Float64Array(n),
    bi = new Float64Array(n);
  ar.set(a);
  br.set(b);
  fft(ar, ai);
  fft(br, bi);
  for (let k = 0; k < n; k++) {
    const hz = (Math.min(k, n - k) * rate) / n;
    const re = ar[k]! * br[k]! + ai[k]! * bi[k]!,
      im = ai[k]! * br[k]! - ar[k]! * bi[k]!;
    const magnitude = Math.hypot(re, im);
    ar[k] = hz >= low && hz <= high && magnitude > 1e-20 ? re / magnitude : 0;
    ai[k] = hz >= low && hz <= high && magnitude > 1e-20 ? im / magnitude : 0;
  }
  fft(ar, ai, true);
  const minimum = Math.floor(Math.min(5 * rate, Math.min(a.length, b.length) / 2));
  const lower = minimum - b.length,
    upper = a.length - minimum;
  const value = (lag: number) => ar[(lag + n) % n]!;
  let best = Math.max(
    lower,
    Math.min(upper, near === undefined ? lower : Math.round(-near * rate)),
  );
  let sum = 0,
    squares = 0,
    count = 0;
  for (let lag = lower; lag <= upper; lag++) {
    const v = value(lag);
    if (
      (near === undefined || Math.abs(lag + near * rate) <= rate * 0.02) &&
      Math.abs(v) > Math.abs(value(best))
    )
      best = lag;
    sum += v;
    squares += v * v;
    count++;
  }
  const peak = value(best),
    spread = Math.sqrt(Math.max(0, squares / count - (sum / count) ** 2));
  const confidence = spread > 0 ? Math.min(10_000, Math.abs(peak) / spread) : 0;
  if (confidence < 15)
    throw new Error(
      `Sound alignment failed: confidence ${confidence.toFixed(1)} is below 15. Choose recordings of the same moment or correct the offset manually.`,
    );
  let fraction = 0;
  if (best > lower && best < upper) {
    const left = value(best - 1),
      right = value(best + 1),
      curve = left - 2 * peak + right;
    if (curve) fraction = Math.max(-0.5, Math.min(0.5, (0.5 * (left - right)) / curve));
  }
  const offset = -(best + fraction) / rate;
  return {
    offset,
    confidence,
    overlapStart: Math.max(0, -offset),
    overlapEnd: Math.min(a.length / rate, b.length / rate - offset),
  };
}

export function alignSound(a: Float32Array, b: Float32Array): SoundMatch {
  const decimate = (samples: Float32Array) =>
    Float32Array.from(
      { length: Math.floor(samples.length / 4) },
      (_, i) =>
        (samples[i * 4]! + samples[i * 4 + 1]! + samples[i * 4 + 2]! + samples[i * 4 + 3]!) / 4,
    );
  const coarse = correlateSound(decimate(a), decimate(b), 2000, 150, 900);
  return correlateSound(a, b, 8000, 100, 3500, coarse.offset);
}
