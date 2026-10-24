import { describe, it, expect, vi } from "vite-plus/test";
import { decodeProjectFile } from "@sidecut/contracts/project";
import { transcribeService } from "./service-transcribe";
import type { MediaAnalysisState } from "./media-analysis";
import type { Transcript } from "@sidecut/core/transcript";

const file = decodeProjectFile({
  revision: 2,
  project: {
    id: "transcription",
    media: [{ id: "m", path: "voice.wav", kind: "audio", hasAudio: true }],
    audioTracks: [
      {
        id: "voice",
        kind: "audio",
        clips: [{ id: "c", duration: 1, content: { media: { mediaID: "m" } } }],
      },
    ],
  },
});
function analysis() {
  let transcript: Transcript | undefined;
  const state: Record<string, MediaAnalysisState> = {};
  const transcribe = vi.fn(async (_id: string, _signal?: AbortSignal): Promise<Transcript> => {
    transcript = { model: "fixture", language: "en", words: [] };
    return transcript;
  });
  return { transcribe, transcriptFor: () => transcript, getSnapshot: () => state };
}
describe("122.02 transcription results", () => {
  it("deduplicates media/clip/path references and reports an empty ready transcript", async () => {
    const worker = analysis();
    const result = await transcribeService(
      file,
      { media: ["m", "c", "voice.wav"], wait: true },
      worker,
      new AbortController().signal,
      () => 3,
    );
    expect(worker.transcribe).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      revision: 3,
      files: [{ kind: "transcript", mediaID: "m", state: "ready", words: 0 }],
      waited: {
        what: "transcript",
        done: true,
        timedOut: false,
        finished: [{ state: "ready" }],
        pending: [],
      },
    });
  });
  it("returns pending work at the deadline and leaves its job running", async () => {
    const worker = analysis();
    let complete: (() => void) | undefined;
    worker.transcribe.mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = () => resolve({ model: "fixture", language: "en", words: [] });
        }),
    );
    const controller = new AbortController();
    const result = await transcribeService(
      file,
      { media: ["m"], wait: true, timeout: 0 },
      worker,
      controller.signal,
      () => 2,
    );
    expect(result).toMatchObject({
      waited: { done: false, timedOut: true, finished: [], pending: [{ state: "queued" }] },
    });
    expect(controller.signal.aborted).toBe(false);
    complete?.();
  });
  it("reports uncached worker failures as finished and rejects missing references", async () => {
    const worker = analysis();
    worker.transcribe.mockRejectedValue(new Error("Model unavailable"));
    expect(
      await transcribeService(
        file,
        { media: ["m"], wait: true },
        worker,
        new AbortController().signal,
        () => 2,
      ),
    ).toMatchObject({
      files: [{ state: "failed", message: "Model unavailable" }],
      waited: { done: true, timedOut: false, pending: [] },
    });
    await expect(
      transcribeService(file, { media: ["absent"] }, worker, new AbortController().signal, () => 2),
    ).rejects.toThrow(/not found/);
    await expect(
      transcribeService(file, { media: [] }, worker, new AbortController().signal, () => 2),
    ).rejects.toThrow(/Name/);
  });
  it("returns queued work without waiting and interrupts a waiting call on cancellation", async () => {
    const worker = analysis();
    worker.transcribe.mockImplementation(() => new Promise(() => {}));
    expect(
      await transcribeService(
        file,
        { media: ["m"] },
        worker,
        new AbortController().signal,
        () => 2,
      ),
    ).toMatchObject({ files: [{ state: "queued" }] });
    const controller = new AbortController();
    const pending = transcribeService(
      file,
      { media: ["m"], wait: true },
      worker,
      controller.signal,
      () => 2,
    );
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(worker.transcribe.mock.calls.at(-1)?.[1]).toBe(controller.signal);
  });
});
