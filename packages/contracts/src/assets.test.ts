import { describe, it, expect } from "vite-plus/test";
import { decodeAsset, searchAssets } from "./assets";
describe("asset metadata", () => {
  const asset = () =>
    decodeAsset({
      provider: "local",
      providerID: "one:variant",
      kind: "icon",
      name: "A camera",
      tags: ["Picture"],
      creditLine: "Maker, CC BY",
      licenceClass: "creditNeeded",
      files: { folder: "local/one", normalised: "icon.png" },
      custom: { kept: true },
    });
  it("keeps identity, attribution and extension data through JSON", () => {
    const a = asset();
    expect(a.id).toBe("local:one:variant");
    expect(decodeAsset(JSON.parse(JSON.stringify(a)))).toEqual(a);
    expect(searchAssets([a], "CAMERA picture", "icon", "creditNeeded")).toEqual([a]);
    expect(searchAssets([a], "camera", "font")).toEqual([]);
  });
  it("rejects mismatched identity and unsafe normalized paths", () => {
    expect(() => decodeAsset({ ...asset(), id: "other:one" })).toThrow("identity");
    for (const path of ["../secret", "/tmp/x", "C:\\file", "a//b", "https://example.com/x"])
      expect(() => decodeAsset({ ...asset(), files: { normalised: path } })).toThrow("relative");
    expect(decodeAsset({ provider: "local", providerID: "x", kind: "font" }).licenceClass).toBe(
      "unknown",
    );
  });
});
