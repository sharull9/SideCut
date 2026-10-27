import { Time, type FrameRate } from "@sidecut/contracts/time";

export function reviewFrameTime(seconds: number, delta: -1 | 1, duration: number, rate: FrameRate) {
  const frame =
    Time.fromSeconds(Math.max(0, seconds)).roundedToFrame(rate).frameIndex(rate) + BigInt(delta);
  return Math.min(duration, Time.frames(frame < 0n ? 0n : frame, rate).seconds);
}

export function reviewShuttleRate(current: number, direction: -1 | 1) {
  return Math.sign(current) === direction
    ? direction * Math.min(8, Math.abs(current) * 2)
    : direction;
}

export function reviewReverseTime(seconds: number, elapsedSeconds: number, rate: number) {
  return Math.max(0, seconds - Math.max(0, elapsedSeconds) * Math.abs(rate));
}
