import { describe, expect, it } from "vite-plus/test";
import { DEFAULT_PANELS, fitPanels, readPanelSizes, readSideTab } from "./panel-sizes";

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
      mediaHidden: false,
      inspectorHidden: false,
    });
  });
  it("keeps the viewer and timeline usable without overwriting saved preferences", () => {
    const saved = {
      media: 560,
      inspector: 600,
      workspace: 9999,
      mediaHidden: false,
      inspectorHidden: false,
    };
    const fitted = fitPanels(saved, 1280, 636);
    expect(fitted.media + fitted.inspector + 420 + 12).toBeCloseTo(1280);
    expect(fitted.media).toBeGreaterThanOrEqual(240);
    expect(fitted.inspector).toBeGreaterThanOrEqual(300);
    expect(fitted.workspace).toBe(454);
    expect(fitPanels(saved, 1920, 996).media).toBe(560);
    expect(saved.workspace).toBe(9999);
  });
  it("collapses hidden side panels to a rail and gives the viewer their space", () => {
    expect(
      readPanelSizes(
        '{"version":1,"media":300,"inspector":320,"workspace":null,"mediaHidden":true}',
      ),
    ).toMatchObject({ media: 300, mediaHidden: true, inspectorHidden: false });
    const fitted = fitPanels(
      { ...DEFAULT_PANELS, mediaHidden: true, inspectorHidden: true },
      1024,
      636,
    );
    expect(fitted.media).toBe(32);
    expect(fitted.inspector).toBe(32);
  });
});

describe("side panel tab preference", () => {
  it("falls back to media for missing or unknown values", () => {
    expect(readSideTab(null)).toBe("media");
    expect(readSideTab("nope")).toBe("media");
    expect(readSideTab("history")).toBe("history");
  });
});
