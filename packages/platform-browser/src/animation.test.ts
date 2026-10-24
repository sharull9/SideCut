import { describe, it, expect } from "vite-plus/test";
import { validateLottie } from "./animation";
describe("local shape animations", () => {
  const data = {
    w: 128,
    h: 128,
    fr: 30,
    ip: 0,
    op: 60,
    layers: [{ ty: 4, ks: { p: { k: [64, 64, 0] } } }],
  };
  it("accepts shape props without rewriting them", () => {
    expect(validateLottie(data)).toBe(data);
  });
  it("rejects external resources, expressions and invalid timing", () => {
    for (const v of [
      { ...data, assets: [{ p: "https://example.com/image.png" }] },
      { ...data, layers: [{ ks: { x: "fetch('x')" } }] },
      { ...data, fr: 0 },
      { ...data, op: 100000 },
      { ...data, fonts: { list: [] } },
    ])
      expect(() => validateLottie(v)).toThrow();
  });
});
