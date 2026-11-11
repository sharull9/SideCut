import { it, expect } from "vite-plus/test";
import {
  DownloadHttpError,
  downloadToFile,
  isAbortError,
  projectFileName,
  type DownloadProgress,
} from "./add-to-project";

function streamOf(chunks: Uint8Array[], headers: Record<string, string> = {}) {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    }),
    { status: 200, headers },
  );
}

it("streams the body with progress and names the file as the playback mp4", async () => {
  const progress: DownloadProgress[] = [];
  const requested: string[] = [];
  const file = await downloadToFile({
    url: "https://storage.example/playback.mp4",
    name: "Launch Clip.mov",
    fetchFn: async (url) => {
      requested.push(url);
      return streamOf([new Uint8Array([1, 2, 3]), new Uint8Array([4, 5, 6])], {
        "content-length": "6",
      });
    },
    onProgress: (next) => progress.push(next),
  });

  expect(requested).toEqual(["https://storage.example/playback.mp4"]);
  expect(file.name).toBe("Launch Clip.mp4");
  expect(file.type).toBe("video/mp4");
  expect(file.size).toBe(6);
  expect(progress).toEqual([
    { loaded: 0, total: 6 },
    { loaded: 3, total: 6 },
    { loaded: 6, total: 6 },
  ]);
});

it("reports unknown totals when Content-Length is missing", async () => {
  const progress: DownloadProgress[] = [];
  await downloadToFile({
    url: "https://storage.example/playback.mp4",
    name: "Clip",
    fetchFn: async () => streamOf([new Uint8Array([9, 9])]),
    onProgress: (next) => progress.push(next),
  });
  expect(progress.at(-1)).toEqual({ loaded: 2, total: undefined });
});

it("cancels mid-download when the signal aborts", async () => {
  const controller = new AbortController();
  let delivered = false;
  const pending = downloadToFile({
    url: "https://storage.example/playback.mp4",
    name: "Clip",
    signal: controller.signal,
    fetchFn: async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          pull(stream) {
            // Deliver one chunk, then stall until the consumer cancels.
            if (delivered) return new Promise(() => {});
            delivered = true;
            stream.enqueue(new Uint8Array([1, 2, 3]));
          },
        }),
        { status: 200, headers: { "content-length": "10" } },
      ),
    onProgress: ({ loaded }) => {
      if (loaded > 0) controller.abort();
    },
  });

  const error = await pending.catch((cause: unknown) => cause);
  expect(isAbortError(error)).toBe(true);
});

it("rejects without fetching when the signal is already aborted", async () => {
  const controller = new AbortController();
  controller.abort();
  let fetched = false;
  const error = await downloadToFile({
    url: "https://storage.example/playback.mp4",
    name: "Clip",
    signal: controller.signal,
    fetchFn: async () => {
      fetched = true;
      return streamOf([]);
    },
  }).catch((cause: unknown) => cause);
  expect(isAbortError(error)).toBe(true);
  expect(fetched).toBe(false);
});

it("throws DownloadHttpError with the status on a non-ok response", async () => {
  const error = await downloadToFile({
    url: "https://storage.example/expired",
    name: "Clip",
    fetchFn: async () => new Response("expired", { status: 403 }),
  }).catch((cause: unknown) => cause);
  expect(error).toBeInstanceOf(DownloadHttpError);
  expect((error as DownloadHttpError).status).toBe(403);
  expect((error as Error).message).toBe("Download failed (HTTP 403). Try again.");
  expect(isAbortError(error)).toBe(false);
});

it("derives the project file name and keeps a media extension", () => {
  expect(projectFileName("Intro.mp4")).toBe("Intro.mp4");
  expect(projectFileName("clip.MOV")).toBe("clip.mp4");
  expect(projectFileName("take 2.final.webm")).toBe("take 2.final.mp4");
  expect(projectFileName("a/b:c*?")).toBe("a_b_c__.mp4");
  expect(projectFileName("   ")).toBe("media.mp4");
  expect(projectFileName("x".repeat(300))).toHaveLength(120 + ".mp4".length);
  expect(projectFileName("Audio", "audio/mpeg")).toBe("Audio.mp3");
  expect(() => projectFileName("Clip", "application/zip")).toThrow("Unsupported media type");
});
