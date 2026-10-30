import { describe, expect, it } from "vite-plus/test";
import { decodeProjectFile } from "@sidecut/contracts/project";
import { LiveStudio } from "./live-studio";
import { DEFAULT_LIVE_ASSETS, LIVE_BACKGROUNDS, liveAssets, withLiveAssets } from "./live-assets";
import { DEFAULT_LIVE_AUDIO, liveAudioSettings, liveMeter } from "./live-audio";

const project = () => decodeProjectFile({ revision: 0, project: { id: "p" } }).project;
const overlay = {
  id: "one",
  kind: "banner",
  text: "Live",
  x: 0,
  y: 0,
  width: 0.5,
  height: 0.1,
  color: "#000000",
  textColor: "#ffffff",
  opacity: 1,
  enabled: true,
  motion: "slide",
  start: 0,
  duration: 10,
};
describe("live assets and sound settings", () => {
  it("has ten animated backgrounds plus a static background and persists ordered assets in scene snapshots", () => {
    expect(LIVE_BACKGROUNDS.filter((b) => b !== "solid")).toHaveLength(10);
    const studio = new LiveStudio();
    const assets = {
      ...DEFAULT_LIVE_ASSETS,
      background: "waves",
      overlays: [overlay, { ...overlay, id: "two", kind: "highlight" }],
    };
    studio.save({
      id: "scene",
      name: "Scene",
      project: withLiveAssets(project(), assets),
      expectedRevision: 0,
    });
    studio.switch({ id: "scene", expectedRevision: 1 });
    expect(LiveStudio.restore(studio.serialize()).frame(1).assets).toEqual(assets);
  });
  it("rejects invalid colors, bounds, duplicate IDs, unbounded overlays and invalid motion", () => {
    expect(() => liveAssets({ ...DEFAULT_LIVE_ASSETS, color: "url(secret)" })).toThrow();
    expect(() => liveAssets({ ...DEFAULT_LIVE_ASSETS, speed: NaN })).toThrow();
    expect(() =>
      liveAssets({ ...DEFAULT_LIVE_ASSETS, overlays: [{ ...overlay, x: 0.9 }] }),
    ).toThrow("bounds");
    expect(() => liveAssets({ ...DEFAULT_LIVE_ASSETS, overlays: [overlay, overlay] })).toThrow(
      "uniquely",
    );
    expect(() =>
      liveAssets({
        ...DEFAULT_LIVE_ASSETS,
        overlays: Array.from({ length: 21 }, (_, i) => ({ ...overlay, id: String(i) })),
      }),
    ).toThrow("20");
  });
  it("validates live gain/delay and measures peak, RMS and clipping", () => {
    expect(liveAudioSettings(DEFAULT_LIVE_AUDIO)).toEqual(DEFAULT_LIVE_AUDIO);
    for (const bad of [
      { gainDB: Infinity },
      { gainDB: 13 },
      { syncOffsetMs: -1 },
      { syncOffsetMs: 2001 },
      { cleanup: "neural" },
    ])
      expect(() => liveAudioSettings({ ...DEFAULT_LIVE_AUDIO, ...bad })).toThrow();
    expect(liveMeter(new Float32Array([0.5, -0.5]))).toMatchObject({
      peak: 0.5,
      rms: 0.5,
      clipped: false,
    });
    expect(liveMeter(new Float32Array([1.1])).clipped).toBe(true);
    expect(liveMeter(new Float32Array()).peakDB).toBe(-Infinity);
    expect(() => liveMeter(new Float32Array([NaN]))).toThrow("Invalid");
  });
});
