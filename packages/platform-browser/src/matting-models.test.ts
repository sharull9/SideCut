import { it, expect } from "vite-plus/test";
import { mattingInput, mattingOutput } from "./matting-models";
it("converts RGB to the official NCHW input and retains fractional alpha without a segmentation threshold", () => {
  expect(mattingInput(new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255]), 2, 1)).toEqual(
    new Float32Array([1, 0, 0, 1, 0, 0]),
  );
  expect(mattingOutput(new Float32Array([0, 0.5, 1]))).toEqual(
    new Uint8ClampedArray([0, 0, 0, 255, 128, 128, 0, 255, 255, 255, 0, 255]),
  );
  expect(() => mattingOutput(new Float32Array([NaN]))).toThrow(/invalid alpha/);
});
