import { describe, it, expect, vi, afterEach } from "vite-plus/test";
import { decodeProjectFile } from "@sidecut/contracts/project";
import { BrowserJobs } from "@sidecut/platform-browser/jobs";
import { sourceSamples, type SourceSamples } from "@sidecut/platform-browser/source-analysis";
import type { BrowserProjectSession } from "./browser-session";
import { MediaAnalysis } from "./media-analysis";

vi.mock("@sidecut/platform-browser/source-analysis", () => ({ sourceSamples: vi.fn() }));
const samples: SourceSamples = {
  duration: 1,
  peaks: new Float32Array([0.5]),
  peaksPerSecond: 1,
  thumbnails: [],
};
function setup() {
  const jobs = new BrowserJobs(1);
  const project = decodeProjectFile({
    revision: 0,
    project: { media: [{ id: "m", path: "source.wav", kind: "audio", duration: 1 }] },
  }).project;
  const session = {
    jobs,
    getSnapshot: () => ({ project, revision: 0 }),
    resource: async () => ({ state: "available", file: new File(["test"], "source.wav") }),
  } as unknown as BrowserProjectSession;
  return { jobs, analysis: new MediaAnalysis(session) };
}
afterEach(() => vi.resetAllMocks());
describe("session-owned source analysis", () => {
  it("shares a decode requested by the bin and timeline and reuses its result", async () => {
    const { analysis } = setup();
    vi.mocked(sourceSamples).mockResolvedValue(samples);
    const bin = analysis.samples("m"),
      timeline = analysis.samples("m");
    expect(bin).toBe(timeline);
    expect(await bin).toBe(samples);
    expect(await analysis.samples("m")).toBe(samples);
    expect(sourceSamples).toHaveBeenCalledTimes(1);
  });
  it("prevents a decoder that finishes after cancellation and project replacement from publishing", async () => {
    const { analysis, jobs } = setup();
    let finish!: (samples: SourceSamples) => void;
    vi.mocked(sourceSamples)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValue(samples);
    const stale = analysis.samples("m");
    const rejected = expect(stale).rejects.toThrow();
    await vi.waitFor(() => expect(sourceSamples).toHaveBeenCalledTimes(1));
    jobs.cancelAll();
    analysis.reset();
    const fresh = analysis.samples("m");
    finish({ ...samples, duration: 99 });
    await rejected;
    expect(await fresh).toBe(samples);
    expect(analysis.getSnapshot().m?.samples?.duration).toBe(1);
    expect(jobs.getSnapshot().map((job) => job.status)).toEqual(["cancelled", "done"]);
  });
});
