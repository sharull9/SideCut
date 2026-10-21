import { describe, expect, it } from "vite-plus/test";
import { FLICKS_PER_SAMPLE, Time, flicksPerFrame } from "./time";

describe("Tandem time", () => {
  it("uses sample-aligned flicks and Swift's negative rounding", () => {
    expect(Time.fromSeconds(0.5 / 48_000).flicks).toBe(FLICKS_PER_SAMPLE);
    expect(Time.fromSeconds(-0.5 / 48_000).flicks).toBe(-FLICKS_PER_SAMPLE);
    expect(Time.fromSeconds(-1 / 48_000).toJSON()).toBe(-0.000021);
  });

  it("keeps arithmetic exact above JavaScript's safe integer flick range", () => {
    const time = new Time(9_007_199_254_740_993n);
    expect(time.add(new Time(1n)).subtract(time).flicks).toBe(1n);
    expect(() => new Time(1n << 63n)).toThrow(RangeError);
  });

  it("matches rational frame math and negative floor/nearest behavior", () => {
    const rate = { numerator: 30_000, denominator: 1_001 };
    expect(flicksPerFrame(rate)).toBe(23_543_520n);
    expect(Time.frames(30_000n, rate).seconds).toBe(1_001);
    expect(new Time(-1n).frameIndex(rate)).toBe(-1n);
    expect(new Time(-11_771_760n).roundedToFrame(rate).flicks).toBe(-23_543_520n);
    expect(new Time(11_771_760n).roundedToFrame(rate).flicks).toBe(23_543_520n);
    expect(() => flicksPerFrame({ numerator: 0, denominator: 1 })).toThrow(RangeError);
  });

  it("preserves sample-aligned values over repeated JSON round trips", () => {
    for (const samples of [-48_001n, -1n, 0n, 1n, 48_001n, 1_000_000_000_000n]) {
      const original = new Time(samples * FLICKS_PER_SAMPLE);
      let decoded = original;
      for (let i = 0; i < 100; i++) decoded = Time.fromSeconds(JSON.parse(JSON.stringify(decoded)));
      expect(decoded.flicks).toBe(original.flicks);
    }
    expect(Time.fromSeconds(1).scaled(1.5).flicks).toBe(Time.fromSeconds(1.5).flicks);
    for (const value of [NaN, Infinity, -Infinity, 1e30]) {
      expect(() => Time.fromSeconds(value)).toThrow(RangeError);
    }
  });
});
