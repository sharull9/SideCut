import { describe, expect, it } from "vite-plus/test";
import { PlaybackClock } from "./preview";

describe("media playback clock", () => {
  it("uses the supplied audio clock, maps audio timestamps and clamps at sequence end", () => {
    let now = 10;
    const clock = new PlaybackClock(() => now);
    clock.start(2, 0.1);
    expect(clock.position(8)).toBe(2);
    expect(clock.audioTime(3)).toBeCloseTo(11.1);
    now = 12.1;
    expect(clock.position(8)).toBeCloseTo(4);
    now = 100;
    expect(clock.position(8)).toBe(8);
  });
  it("reanchors a seek instead of accumulating elapsed time", () => {
    let now = 10;
    const clock = new PlaybackClock(() => now);
    clock.start(0);
    now = 11;
    clock.start(5);
    now = 11.5;
    expect(clock.position(20)).toBe(5.5);
  });
});
