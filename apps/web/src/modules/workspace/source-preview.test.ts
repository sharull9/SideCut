import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { decodeProjectFile } from "@sidecut/contracts/project";
import { LocalMediaReader } from "@sidecut/platform-browser/preview";
import { SourcePreview } from "./source-preview";
import type { BrowserProjectSession } from "./browser-session";

const project = () =>
  decodeProjectFile({
    revision: 0,
    project: {
      media: [{ id: "med", path: "test.webm", hasVideo: true, hasAudio: true }],
      videoTracks: [
        {
          id: "video",
          kind: "video",
          clips: [
            {
              id: "picture",
              content: { media: { mediaID: "med" } },
              duration: 0.5,
              sourceStart: 0.2,
            },
          ],
        },
      ],
      audioTracks: [
        {
          id: "audio",
          kind: "audio",
          clips: [
            {
              id: "sound",
              content: { media: { mediaID: "med" } },
              duration: 0.5,
              sourceStart: 0.2,
            },
          ],
        },
      ],
    },
  }).project;

describe("source preview lifecycle", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  const setup = () => {
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn(() => 1),
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const draw = vi.fn();
    vi.stubGlobal("document", {
      createElement: () => {
        const stage = {
          width: 0,
          height: 0,
          getContext: () => ({
            canvas: stage,
            save: vi.fn(),
            restore: vi.fn(),
            setTransform: vi.fn(),
            translate: vi.fn(),
            rotate: vi.fn(),
            fillRect: vi.fn(),
            drawImage: vi.fn(),
          }),
        };
        return stage;
      },
    });
    const canvas = {
      width: 64,
      height: 64,
      dataset: {},
      getContext: () => ({ clearRect: vi.fn(), drawImage: draw }),
    } as unknown as HTMLCanvasElement;
    const state = project();
    const session = {
      getSnapshot: () => ({ project: state }),
      resource: async () => ({ state: "available", file: new File(["test"], "test.webm") }),
    } as unknown as BrowserProjectSession;
    const onTime = vi.fn(),
      onStopped = vi.fn(),
      onError = vi.fn();
    const engine = new SourcePreview(canvas, session, onTime, onStopped, onError);
    return { engine, draw, onTime, onStopped, onError };
  };
  it("discards a decoded frame after a seek supersedes it, and releases source readers", async () => {
    const { engine, draw } = setup();
    let finish!: (value: Awaited<ReturnType<LocalMediaReader["frame"]>>) => void;
    const reader = {
      frame: vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              finish = resolve;
            }),
        )
        .mockResolvedValue({ canvas: {}, width: 64, height: 64, timestamp: 0.3, duration: 0.1 }),
      close: vi.fn(),
    };
    vi.spyOn(LocalMediaReader, "open").mockResolvedValue(reader as unknown as LocalMediaReader);
    engine.seek(0);
    await vi.waitFor(() => expect(reader.frame).toHaveBeenCalled());
    engine.seek(0.1);
    finish({
      canvas: {} as HTMLCanvasElement,
      width: 64,
      height: 64,
      timestamp: 0.2,
      duration: 0.1,
    });
    await vi.waitFor(() => expect(draw).toHaveBeenCalledTimes(1));
    expect(reader.frame.mock.calls[1]?.[0]).toBeCloseTo(0.3);
    engine.close();
    await Promise.resolve();
    expect(reader.close).toHaveBeenCalled();
  });
  it("schedules a source offset against Web Audio time and cancels sound on pause", async () => {
    const { engine, onError } = setup();
    const node = {
      buffer: null,
      connect: vi.fn(),
      disconnect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      onended: null,
    };
    const context = {
      currentTime: 0,
      destination: {},
      resume: async () => {},
      close: async () => {},
      createBufferSource: () => node,
      createBuffer: (_channels: number, frames: number) => ({
        getChannelData: () => new Float32Array(frames),
      }),
    };
    vi.stubGlobal(
      "AudioContext",
      vi.fn(function AudioContextMock() {
        return context;
      }),
    );
    const reader = {
      frame: async () => ({ canvas: {}, width: 64, height: 64, timestamp: 0.2, duration: 0.1 }),
      audio: async function* () {
        yield {
          buffer: {
            sampleRate: 48000,
            length: 48000,
            numberOfChannels: 1,
            getChannelData: () => new Float32Array(48000).fill(0.5),
          },
          timestamp: 0,
          duration: 1,
        };
      },
      close: vi.fn(),
    };
    vi.spyOn(LocalMediaReader, "open").mockResolvedValue(reader as unknown as LocalMediaReader);
    await engine.play(0);
    await vi.waitFor(() => expect(node.start).toHaveBeenCalled());
    const args = node.start.mock.calls[0];
    expect(args?.[0]).toBeCloseTo(0.1);
    expect(args?.[1]).toBe(0);
    expect(args?.[2]).toBeCloseTo(4096 / 48000);
    engine.pause();
    expect(node.stop).toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalledWith(expect.any(String));
    engine.close();
  });
});
