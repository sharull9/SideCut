import { describe, expect, it } from "vite-plus/test";
import { DEFAULT_PANELS, fitPanels, readPanelSizes } from "./panel-sizes";

describe("editor panel sizing", () => {
  it("ignores corrupt/old preferences and clamps valid saved widths", () => {
    for (const value of [
      null,
      "{",
      "null",
      '{"version":2}',
      '{"version":1,"media":"wide","inspector":300,"workspace":null}',
    ])
      expect(readPanelSizes(value)).toEqual(DEFAULT_PANELS);
    expect(readPanelSizes('{"version":1,"media":-1,"inspector":9999,"workspace":420}')).toEqual({
      media: 240,
      inspector: 600,
      workspace: 420,
    });
  });
  it("keeps the viewer and timeline usable without overwriting saved preferences", () => {
    const saved = { media: 560, inspector: 600, workspace: 9999 };
    const fitted = fitPanels(saved, 1280, 636);
    expect(fitted.media + fitted.inspector + 420 + 12).toBeCloseTo(1280);
    expect(fitted.media).toBeGreaterThanOrEqual(240);
    expect(fitted.inspector).toBeGreaterThanOrEqual(300);
    expect(fitted.workspace).toBe(454);
    expect(fitPanels(saved, 1920, 996).media).toBe(560);
    expect(saved.workspace).toBe(9999);
  });
});
