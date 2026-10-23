import { describe, it, expect } from "vite-plus/test";
import { addPeaks } from "./source-analysis";
import { proxyFrameIndex, type PictureProxy } from "./proxy";
describe("derived source samples", () => {
  it("bins all channels at source timestamps, preserving late starts and packet boundaries", () => {
    const peaks = new Float32Array(5);
    addPeaks(peaks, [new Float32Array([0.2, -0.4]), new Float32Array([0.5, 0.1])], 100, 0.02);
    addPeaks(peaks, [new Float32Array([0.7])], 100, 0.04);
    expect([...peaks]).toEqual([0, 0, 0.5, expect.closeTo(0.4), expect.closeTo(0.7)]);
  });
  it("maps proxy frames through nonzero timestamps, variable durations and gaps", () => {
    const proxy: PictureProxy = {
      format: "png-sequence-v1",
      width: 10,
      height: 10,
      frames: [
        { timestamp: 1, duration: 0.1, image: new Blob() },
        { timestamp: 1.1, duration: 0.3, image: new Blob() },
        { timestamp: 2, duration: 0.1, image: new Blob() },
      ],
    };
    expect([0, 1, 1.09, 1.1, 1.39, 1.6, 2].map((t) => proxyFrameIndex(proxy, t))).toEqual([
      -1, 0, 0, 1, 1, -1, 2,
    ]);
  });
});
