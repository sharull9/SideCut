import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { decodeProjectFile, encodeProjectFile } from "@sidecut/contracts/project";
import type { FolderMedia, HostSnapshot, NativeBridge } from "@sidecut/contracts/desktop";
import type { StorageRequest } from "@sidecut/contracts/storage";
import { BrowserProjectStore } from "@sidecut/platform-browser/storage";
import { DurableStorage } from "@sidecut/platform-browser/sqlite-client";
import { renderWebM } from "@sidecut/platform-browser/export";
import { probeLocalFile } from "@sidecut/platform-browser/media";
import type * as MediaModule from "@sidecut/platform-browser/media";
import { BrowserProjectSession } from "./browser-session";

vi.mock("@sidecut/platform-browser/export", () => ({ renderWebM: vi.fn() }));
vi.mock("@sidecut/platform-browser/media", async (importOriginal) => ({
  ...(await importOriginal<typeof MediaModule>()),
  probeLocalFile: vi.fn(),
}));

const projectJSON = () =>
  encodeProjectFile(
    decodeProjectFile({
      revision: 0,
      project: {
        id: "prj_host",
        name: "Host",
        videoTracks: [{ id: "trk_video_0", kind: "video", name: "Screen", rippleMode: "cut" }],
        audioTracks: [{ id: "trk_audio_0", kind: "audio", name: "Voice", rippleMode: "cut" }],
      },
    }),
  );

describe("native host session ownership", () => {
  let sequence: number;
  let generation: number;
  let projectListeners: ((snapshot: HostSnapshot) => void)[];
  let folderListeners: ((files: FolderMedia[], error: string | null) => void)[];
  let session: BrowserProjectSession;
  const snapshot = (): HostSnapshot => ({
    sequence,
    generation,
    json: projectJSON(),
    undoLabel: null,
    redoLabel: null,
    lastChange: null,
    saveState: "saved",
    error: null,
  });
  /** The host replaces the project: a new generation arrives over the subscription. */
  const replaceProject = () => {
    sequence++;
    generation++;
    for (const listener of projectListeners) listener(snapshot());
  };
  const nativeMedia = vi.fn(async () =>
    new TextEncoder().encode(JSON.stringify({ format: { duration: "1" }, streams: [] })),
  );

  beforeEach(async () => {
    sequence = 1;
    generation = 1;
    projectListeners = [];
    folderListeners = [];
    nativeMedia.mockClear();
    const bridge = {
      projectRequest: () => ({ snapshot: snapshot(), result: null }),
      projectSubscribe: (listener: (snapshot: HostSnapshot) => void) => {
        projectListeners.push(listener);
        return () => {
          projectListeners = projectListeners.filter((value) => value !== listener);
        };
      },
      folderSubscribe: (listener: (files: FolderMedia[], error: string | null) => void) => {
        folderListeners.push(listener);
        return () => {
          folderListeners = folderListeners.filter((value) => value !== listener);
        };
      },
      projectFlush: async () => {},
      nativeMedia,
    } as unknown as NativeBridge;
    vi.stubGlobal("window", { sidecutDesktop: bridge });
    vi.spyOn(BrowserProjectStore, "open").mockResolvedValue({
      resource: async () => null,
      putResource: async () => {},
      close: vi.fn(),
    } as unknown as BrowserProjectStore);
    vi.spyOn(DurableStorage, "open").mockResolvedValue({
      request: async (request: StorageRequest) => (request.type === "read" ? [] : []),
    } as unknown as DurableStorage);
    session = new BrowserProjectSession();
    await session.start();
  });
  afterEach(async () => {
    await session.close();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("cancels a foreground export when the host replaces the project", async () => {
    let jobSignal!: AbortSignal;
    vi.mocked(renderWebM).mockImplementation(
      (_project, _resource, signal) =>
        new Promise((_resolve, reject) => {
          jobSignal = signal;
          signal.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    const exporting = session.exportWebM(new AbortController().signal, () => {});
    const outcome = exporting.then(
      () => "done",
      () => "failed",
    );
    await vi.waitFor(() => expect(jobSignal).toBeDefined());
    expect(session.getSnapshot().busy).toBe(true);

    replaceProject();

    expect(await outcome).toBe("failed");
    expect(jobSignal.aborted).toBe(true);
    expect(session.getSnapshot().busy).toBe(false);
  });

  it("does not let a stale export completion clear a newer operation", async () => {
    let finishOld!: () => void;
    vi.mocked(renderWebM).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishOld = () => resolve(new Blob());
        }),
    );
    const old = session.exportWebM(new AbortController().signal, () => {});
    const oldSettled = old.catch(() => {});
    await vi.waitFor(() => expect(finishOld).toBeTypeOf("function"));

    // The host generation change releases the old slot while the old export is still running.
    replaceProject();
    expect(session.getSnapshot().busy).toBe(false);

    let finishNew!: () => void;
    vi.mocked(renderWebM).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishNew = () => resolve(new Blob());
        }),
    );
    const next = session.exportWebM(new AbortController().signal, () => {});
    await vi.waitFor(() => expect(finishNew).toBeTypeOf("function"));

    finishOld();
    await oldSettled;
    expect(session.getSnapshot().busy).toBe(true);

    finishNew();
    await next;
    expect(session.getSnapshot().busy).toBe(false);
  });

  it("waits for a foreground operation before importing watched folder media", async () => {
    vi.mocked(probeLocalFile).mockResolvedValue({
      item: {
        id: "med_folder",
        kind: "audio",
        role: "other",
        path: "a.wav",
        fingerprint: "folder",
        duration: 1,
        hasAudio: true,
        hasVideo: false,
      },
      resource: { file: new File(["audio"], "a.wav"), state: "available", detail: "Local" },
    });
    let finishExport!: () => void;
    vi.mocked(renderWebM).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishExport = () => resolve(new Blob());
        }),
    );
    const exporting = session.exportWebM(new AbortController().signal, () => {});
    await vi.waitFor(() => expect(finishExport).toBeTypeOf("function"));
    expect(session.getSnapshot().busy).toBe(true);

    for (const listener of folderListeners)
      listener(
        [
          {
            path: "a.wav",
            bytes: new Uint8Array([1]),
            modified: 0,
            role: "voice",
            shortAudioFallback: false,
          },
        ],
        null,
      );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(nativeMedia).not.toHaveBeenCalled();

    finishExport();
    await exporting;
    await vi.waitFor(() => expect(nativeMedia).toHaveBeenCalledTimes(1));
  });
});
