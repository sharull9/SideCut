import { expect, it } from "vite-plus/test";
import { effectsCatalog, effectRegistry } from "./effects";
import contract from "../../../tests/fixtures/tandem/resources-assets.json";
it("returns the pinned transition, layout and animation catalog alongside filtered effects", () => {
  const all = effectsCatalog(),
    filtered = effectsCatalog("BLUR");
  expect(all.effects).toHaveLength(effectRegistry.length);
  expect(all.transitions).toHaveLength(contract.effects.transitions);
  expect(all.layouts).toHaveLength(contract.effects.layouts);
  expect(all.transitions).toEqual([
    { type: "dissolve", defaultDuration: 0.5 },
    { type: "fadeToBlack", defaultDuration: 1.1 },
    { type: "fadeFromBlack", defaultDuration: 1.1 },
    { type: "push", defaultDuration: 0.7 },
    { type: "slide", defaultDuration: 0.7 },
    { type: "cutSlide", defaultDuration: 0.57 },
    { type: "wipe", defaultDuration: 0.6 },
    { type: "zoom", defaultDuration: 0.5 },
  ]);
  expect(all.layouts.map((l) => l.preset)).toEqual([
    "full",
    "pipRight",
    "pipLeft",
    "split",
    "fill",
  ]);
  expect(all.animatable).toContain("video.effects.<effectID>.<param>");
  expect(filtered.effects.map((e) => e.type)).toEqual(["blur"]);
  expect(filtered.transitions).toEqual(all.transitions);
  expect(() => effectsCatalog("missing")).toThrow("Unknown effect");
});
