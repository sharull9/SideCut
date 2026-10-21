// Ported from TandemCore/Time.swift. See tests/fixtures/tandem/README.md for provenance.
export const FLICKS_PER_SECOND = 705_600_000n;
export const FLICKS_PER_SAMPLE = 14_700n;
const MIN_FLICKS = -(1n << 63n);
const MAX_FLICKS = (1n << 63n) - 1n;

export interface FrameRate {
  readonly numerator: number;
  readonly denominator: number;
}

// Swift rounds half values away from zero; Math.round rounds negative halves toward zero.
function roundAway(value: number): number {
  return Math.sign(value) * Math.round(Math.abs(value));
}

export class Time {
  readonly flicks: bigint;

  constructor(flicks: bigint) {
    if (flicks < MIN_FLICKS || flicks > MAX_FLICKS) {
      throw new RangeError("Time exceeds Tandem's signed 64-bit flick range.");
    }
    this.flicks = flicks;
  }

  static fromSeconds(seconds: number): Time {
    const samples = roundAway(seconds * 48_000);
    if (!Number.isSafeInteger(samples)) throw new RangeError("Time must be finite and in range.");
    return new Time(BigInt(samples) * FLICKS_PER_SAMPLE);
  }

  static frames(count: bigint, rate: FrameRate): Time {
    return new Time(count * flicksPerFrame(rate));
  }

  add(other: Time): Time {
    return new Time(this.flicks + other.flicks);
  }

  subtract(other: Time): Time {
    return new Time(this.flicks - other.flicks);
  }

  scaled(by: number): Time {
    return Time.fromSeconds(this.seconds * by);
  }

  get seconds(): number {
    return Number(this.flicks) / Number(FLICKS_PER_SECOND);
  }

  frameIndex(rate: FrameRate): bigint {
    const perFrame = flicksPerFrame(rate);
    return this.flicks >= 0n
      ? this.flicks / perFrame
      : -((-this.flicks + perFrame - 1n) / perFrame);
  }

  roundedToFrame(rate: FrameRate): Time {
    const perFrame = flicksPerFrame(rate);
    const half = perFrame / 2n;
    const frames =
      this.flicks >= 0n ? (this.flicks + half) / perFrame : -((-this.flicks + half) / perFrame);
    return new Time(frames * perFrame);
  }

  toJSON(): number {
    const seconds = roundAway(this.seconds * 1_000_000) / 1_000_000;
    // A JSON number cannot represent every extreme Int64 time at sample precision.
    if (Time.fromSeconds(seconds).flicks !== Time.fromSeconds(this.seconds).flicks) {
      throw new RangeError("Time cannot round-trip through Tandem JSON at sample precision.");
    }
    return seconds === 0 ? 0 : seconds;
  }
}

export function flicksPerFrame(rate: FrameRate): bigint {
  if (
    !Number.isSafeInteger(rate.numerator) ||
    !Number.isSafeInteger(rate.denominator) ||
    rate.numerator <= 0 ||
    rate.denominator <= 0
  ) {
    throw new RangeError("Frame rate needs positive safe integer numerator and denominator.");
  }
  const numerator = BigInt(rate.numerator);
  return (FLICKS_PER_SECOND * BigInt(rate.denominator) + numerator / 2n) / numerator;
}
