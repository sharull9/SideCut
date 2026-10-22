// Ported from TandemRender/CubeLUT.swift. Notice: tests/fixtures/tandem/TANDEM-LICENSE.
export interface CubeLUT {
  title?: string | undefined;
  dimension: number;
  data: Float32Array;
  domainMin: number[];
  domainMax: number[];
}
export function parseCube(text: string): CubeLUT {
  if (text.length > 32 * 1024 * 1024) throw new Error("LUT exceeds the browser's 32 MB limit.");
  let title: string | undefined, size3D: number | undefined, size1D: number | undefined;
  let domainMin = [0, 0, 0],
    domainMax = [1, 1, 1];
  const values: number[] = [];
  for (const raw of text.split(/\r?\n|\r/)) {
    const line = raw.replace(/#.*/, "").trim();
    if (!line) continue;
    const parts = line.split(/\s+/),
      key = parts[0]!.toUpperCase();
    if (key === "TITLE") {
      title = line.slice(5).trim().replace(/^"|"$/g, "");
      continue;
    }
    if (key === "LUT_3D_SIZE" || key === "LUT_1D_SIZE") {
      const n = Number(parts[1]);
      if (!Number.isInteger(n) || n < 2 || n > (key === "LUT_3D_SIZE" ? 128 : 1_000_000))
        throw new Error("LUT size must be 2-128 for a 3D cube or 2-1000000 for a 1D table.");
      if (key === "LUT_3D_SIZE") size3D = n;
      else size1D = n;
      continue;
    }
    if (key === "DOMAIN_MIN" || key === "DOMAIN_MAX") {
      const domain = parts.slice(1).map(Number);
      if (domain.length !== 3 || domain.some((n) => !Number.isFinite(n)))
        throw new Error("LUT domain needs three finite values.");
      if (key === "DOMAIN_MIN") domainMin = domain;
      else domainMax = domain;
      continue;
    }
    if (/^[A-Za-z_]/.test(line)) continue;
    const row = parts.map(Number);
    if (row.length !== 3 || row.some((n) => !Number.isFinite(n)))
      throw new Error("LUT data rows need three finite color values.");
    values.push(...row);
    if (values.length > 128 ** 3 * 3) throw new Error("LUT contains too many rows.");
  }
  if (domainMin.some((v, i) => v >= domainMax[i]!))
    throw new Error("LUT domain maximum must exceed its minimum.");
  if (size3D && size1D)
    throw new Error("Combined 1D/3D LUTs are not supported by the pinned reference format.");
  const n = size3D ?? size1D;
  if (!n) throw new Error("The .cube file has no LUT_3D_SIZE or LUT_1D_SIZE.");
  const expected = size3D ? n ** 3 : n;
  if (values.length !== expected * 3)
    throw new Error(`The LUT needs ${expected} entries but has ${values.length / 3}.`);
  if (size3D) return { title, dimension: n, data: new Float32Array(values), domainMin, domainMax };
  const dimension = 33,
    data = new Float32Array(dimension ** 3 * 3);
  const curve = (channel: number, x: number) => {
    const p = x * (n - 1),
      i = Math.min(Math.floor(p), n - 2),
      f = p - i;
    return values[i * 3 + channel]! * (1 - f) + values[(i + 1) * 3 + channel]! * f;
  };
  let index = 0;
  for (let b = 0; b < dimension; b++)
    for (let g = 0; g < dimension; g++)
      for (let r = 0; r < dimension; r++) {
        data[index++] = curve(0, r / 32);
        data[index++] = curve(1, g / 32);
        data[index++] = curve(2, b / 32);
      }
  return { title, dimension, data, domainMin, domainMax };
}
export function sampleCube(lut: CubeLUT, rgb: readonly number[]): [number, number, number] {
  const n = lut.dimension;
  const positions = rgb.map(
    (v, i) =>
      Math.max(0, Math.min(1, (v - lut.domainMin[i]!) / (lut.domainMax[i]! - lut.domainMin[i]!))) *
      (n - 1),
  );
  const base = positions.map((v) => Math.min(n - 2, Math.floor(v))),
    frac = positions.map((v, i) => v - base[i]!);
  const out: [number, number, number] = [0, 0, 0];
  for (let b = 0; b < 2; b++)
    for (let g = 0; g < 2; g++)
      for (let r = 0; r < 2; r++) {
        const weight =
          (r ? frac[0]! : 1 - frac[0]!) *
          (g ? frac[1]! : 1 - frac[1]!) *
          (b ? frac[2]! : 1 - frac[2]!);
        const index = ((base[2]! + b) * n * n + (base[1]! + g) * n + base[0]! + r) * 3;
        for (let c = 0; c < 3; c++) out[c]! += lut.data[index + c]! * weight;
      }
  return out;
}
