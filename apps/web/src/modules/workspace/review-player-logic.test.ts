import { describe, expect, it } from "vite-plus/test";
import { reviewFrameTime, reviewReverseTime, reviewShuttleRate } from "./review-player-logic";

describe("review transport", () => {
  it("steps on the rendered clock at the frozen rational frame rate and clamps both ends", () => {
    const rate = { numerator: 30000, denominator: 1001 };
    let time = 0;
    for (let i = 0; i < 100; i++) time = reviewFrameTime(time, 1, 10, rate);
    expect(time).toBeCloseTo((100 * 1001) / 30000, 6);
    expect(reviewFrameTime(0, -1, 10, rate)).toBe(0);
    expect(reviewFrameTime(9.99, 1, 10, rate)).toBe(10);
    expect(reviewFrameTime(time, -1, 10, rate)).toBeCloseTo((99 * 1001) / 30000, 6);
  });
  it("accelerates in one direction, switches direction at 1x, and bounds reverse seeks", () => {
    expect(reviewShuttleRate(0, -1)).toBe(-1);
    expect(reviewShuttleRate(-1, -1)).toBe(-2);
    expect(reviewShuttleRate(-8, -1)).toBe(-8);
    expect(reviewShuttleRate(-4, 1)).toBe(1);
    expect(reviewReverseTime(1, 0.2, -2)).toBeCloseTo(0.6);
    expect(reviewReverseTime(1, 2, -8)).toBe(0);
  });
});
