// Ported from TandemMedia/SpeechEnergy.swift at 735a9b8. See tests/fixtures/tandem/TANDEM-LICENSE.
export function speechEnergy(samples: Float32Array, rate = 32000, start = 0) {
  const high = samples.slice(),
    w = (2 * Math.PI * 4000) / rate,
    alpha = Math.sin(w) / (2 * Math.sqrt(0.5)),
    a0 = 1 + alpha;
  for (let pass = 0; pass < 2; pass++) {
    let x1 = 0,
      x2 = 0,
      y1 = 0,
      y2 = 0;
    for (let i = 0; i < high.length; i++) {
      const x = high[i]!,
        y =
          ((1 + Math.cos(w)) / 2 / a0) * x -
          ((1 + Math.cos(w)) / a0) * x1 +
          ((1 + Math.cos(w)) / 2 / a0) * x2 +
          ((2 * Math.cos(w)) / a0) * y1 -
          ((1 - alpha) / a0) * y2;
      x2 = x1;
      x1 = x;
      y2 = y1;
      y1 = y;
      high[i] = y;
    }
  }
  const count = Math.floor(samples.length / Math.round(rate * 0.01)),
    size = Math.round(rate * 0.01);
  const levels = (values: Float32Array) =>
    Array.from({ length: count }, (_, i) => {
      let sum = 0;
      for (let k = i * size; k < (i + 1) * size; k++) sum += values[k]! ** 2;
      const rms = Math.sqrt(sum / size);
      return rms > 1e-6 ? 20 * Math.log10(rms) : -120;
    });
  return { start, full: levels(samples), high: levels(high) };
}
export function speechLevels(energy: ReturnType<typeof speechEnergy>) {
  const spread = (values: number[]) => {
    const sorted = values.toSorted((a, b) => a - b);
    return {
      floor: sorted[Math.floor(sorted.length / 10)] ?? -120,
      loud: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))] ?? -120,
    };
  };
  const f = spread(energy.full),
    h = spread(energy.high),
    full = Math.max(f.floor + 10, f.loud - 25),
    high = Math.max(h.floor + 10, h.loud - 15);
  return {
    full,
    high,
    fullSpeech: Math.max(full, f.loud - 20),
    highSpeech: Math.max(high, h.loud - 10),
    highLoud: h.loud,
    isVoice: f.loud > -60,
  };
}
export function auditCut(
  energy: ReturnType<typeof speechEnergy>,
  levels: ReturnType<typeof speechLevels>,
  time: number,
  side: "before" | "after",
) {
  const count = energy.full.length,
    quiet = energy.full.map((v, i) => v < levels.full && energy.high[i]! < levels.high),
    pause = quiet.map(() => false);
  let runStart = 0;
  for (let i = 0; i <= count; i++)
    if (i === count || !quiet[i]) {
      if (i > runStart && (i - runStart >= 8 || runStart === 0 || i === count))
        for (let k = runStart; k < i; k++) pause[k] = true;
      runStart = i + 1;
    }
  const isPause = (i: number) => i < 0 || i >= count || pause[i]!,
    x = (time - energy.start) / 0.01,
    before = Math.ceil(x - 1e-6) - 1,
    after = Math.floor(x + 1e-6);
  const kept = side === "before" ? before : after,
    dir = side === "before" ? -1 : 1,
    lost = side === "before" ? after : before;
  if (!levels.isVoice || isPause(kept) || isPause(lost)) return { clipped: false };
  const stretch = (first: number, direction: number) => {
    const frames: number[] = [];
    for (let i = first; !isPause(i) && frames.length < 30; i += direction) frames.push(i);
    return frames;
  };
  const speech = (frames: number[]) =>
    Math.max(
      frames.filter((i) => energy.full[i]! >= levels.fullSpeech).length,
      frames.filter((i) => energy.high[i]! >= levels.highSpeech).length,
    );
  if (speech(stretch(kept, dir)) < 5 || speech(stretch(lost, -dir)) < 5) return { clipped: false };
  const peak = (first: number, direction: number, band: number[], n = 10) =>
    Math.max(...Array.from({ length: n }, (_, i) => band[first + i * direction] ?? -120));
  const edge = Math.min(
    ...Array.from({ length: after - before + 3 }, (_, i) => energy.full[before - 1 + i] ?? -120),
  );
  if (
    edge <= Math.min(peak(kept, dir, energy.full), peak(lost, -dir, energy.full)) - 12 &&
    !(side === "before" && peak(lost, 1, energy.high, 3) >= levels.highLoud + 8)
  )
    return { clipped: false };
  const nearest = (first: number, direction: number) => {
    let i = first;
    while (!isPause(i)) i += direction;
    const distance = Math.abs(energy.start + (direction > 0 ? i : i + 1) * 0.01 - time);
    return { i, distance, direction };
  };
  const option = [nearest(kept, dir), nearest(lost, -dir)]
    .filter((p) => p.distance <= 0.3 + 1e-9)
    .sort((a, b) => a.distance - b.distance)[0];
  if (!option) return { clipped: true };
  let low = option.i,
    high = option.i;
  if (low < 0)
    return {
      clipped: true,
      suggestion: energy.start - 0.04,
      pause: [energy.start - 1, energy.start],
    };
  if (high >= count)
    return {
      clipped: true,
      suggestion: energy.start + count * 0.01 + 0.04,
      pause: [energy.start + count * 0.01, energy.start + count * 0.01 + 1],
    };
  while (low > 0 && pause[low - 1]) low--;
  while (high + 1 < count && pause[high + 1]) high++;
  const a = energy.start + low * 0.01,
    b = energy.start + (high + 1) * 0.01,
    pad = Math.min(0.04, (b - a) / 2);
  return { clipped: true, suggestion: option.direction > 0 ? a + pad : b - pad, pause: [a, b] };
}
