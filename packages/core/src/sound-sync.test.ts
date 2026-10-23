import { describe, it, expect } from "vite-plus/test";
import { alignSound } from "./sound-sync";
function noise(length: number, seed = 42) {
  return Float32Array.from({ length }, () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 2 ** 32 - 0.5;
  });
}
describe("GCC-PHAT alignment", () => {
  it("recovers positive and negative source offsets despite gain and polarity differences", () => {
    const reference = noise(8000 * 6),
      delay = 1973;
    const file = new Float32Array(reference.length + delay);
    file.set(
      reference.map((v) => -v * 0.2),
      delay,
    );
    const result = alignSound(reference, file);
    expect(result.offset).toBeCloseTo(delay / 8000, 4);
    expect(result.confidence).toBeGreaterThan(15);
    expect(alignSound(file, reference).offset).toBeCloseTo(-delay / 8000, 4);
  });
  it("refuses silence and unrelated recordings", () => {
    expect(() => alignSound(new Float32Array(16000), new Float32Array(16000))).toThrow(
      /confidence/,
    );
    expect(() => alignSound(noise(48000), noise(48000, 16))).toThrow(/confidence/);
  });
});
