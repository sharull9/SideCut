// TandemRender/MixMeter.swift at 735a9b8. See tests/fixtures/tandem/TANDEM-LICENSE.
export function compareGains(
  expected: readonly (number | null)[],
  measured: readonly (number | null)[],
  start: number,
  block = 0.01,
  tolerance = 1,
) {
  const count = Math.min(expected.length, measured.length);
  let compared = 0,
    worstDB: number | null = null,
    lateBy: number | null = null;
  for (let i = 0; i < count; i++) {
    const e = expected[i],
      m = measured[i];
    if (e == null || m == null) continue;
    compared++;
    worstDB = Math.max(worstDB ?? 0, Math.abs(m - e));
  }
  const values = expected.slice(0, count).filter((v): v is number => v != null);
  const error = (shift: number) => {
    let sum = 0,
      n = 0;
    for (let i = 0; i < count; i++) {
      const e = expected[i - shift],
        m = measured[i];
      if (i - shift < 0 || i - shift >= count || e == null || m == null) continue;
      sum += Math.abs(m - e);
      n++;
    }
    return n ? sum / n : null;
  };
  if (values.length && Math.max(...values) - Math.min(...values) >= 3) {
    const initial = error(0);
    let best = initial ?? Infinity,
      shift = 0;
    for (
      let i = -Math.min(50, Math.floor(count / 2));
      i <= Math.min(50, Math.floor(count / 2));
      i++
    ) {
      const next = error(i);
      if (next != null && next < best) {
        best = next;
        shift = i;
      }
    }
    if (shift && initial != null && initial > 0.02 && best < initial * 0.5) lateBy = shift * block;
  }
  const mismatches: { start: number; end: number; expectedDB: number; measuredDB: number }[] = [];
  let run: { first: number; last: number; worst: number } | null = null;
  const close = () => {
    if (run)
      mismatches.push({
        start: start + run.first * block,
        end: start + (run.last + 1) * block,
        expectedDB: expected[run.worst]!,
        measuredDB: measured[run.worst]!,
      });
    run = null;
  };
  for (let i = 0; i < count; i++) {
    const e = expected[i],
      m = measured[i];
    if (e == null || m == null || Math.abs(m - e) <= tolerance) continue;
    if (run && i - run.last <= Math.max(1, Math.round(0.05 / block))) {
      run.last = i;
      if (Math.abs(m - e) > Math.abs(measured[run.worst]! - expected[run.worst]!)) run.worst = i;
    } else {
      close();
      run = { first: i, last: i, worst: i };
    }
  }
  close();
  return { compared: compared * block, lateBy, worstDB, mismatches: mismatches.slice(0, 10) };
}
