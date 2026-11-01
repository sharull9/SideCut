import { describe, expect, it } from "vite-plus/test";
import { validReviewRange } from "./rendered-review-range";

describe("review version ranges", () => {
  it("accepts points and ranges within the rendered clock", () => {
    expect(validReviewRange(0, 0, 10)).toBe(true);
    expect(validReviewRange(4, 6, 10)).toBe(true);
  });
  it("rejects invalid values and anchors outside the rendered version", () => {
    expect(validReviewRange(10, 0, 10)).toBe(false);
    expect(validReviewRange(9, 2, 10)).toBe(false);
    expect(validReviewRange(-1, 0, 10)).toBe(false);
    expect(validReviewRange(1, Number.NaN, 10)).toBe(false);
  });
});
