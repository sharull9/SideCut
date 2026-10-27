import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { decodeProjectFile, encodeProjectFile } from "@sidecut/contracts/project";
import type { ProjectFile } from "@sidecut/contracts/project";
import { BrowserProjectStore } from "@sidecut/platform-browser/storage";
import { DurableStorage } from "@sidecut/platform-browser/sqlite-client";
import { acquireProjectWriter } from "@sidecut/platform-browser/writer-lock";
import { probeLocalFile } from "@sidecut/platform-browser/media";
import type * as MediaModule from "@sidecut/platform-browser/media";
import { BrowserProjectSession } from "./browser-session";
import { libraryOperation } from "./service-library";
import { serviceRequest } from "@sidecut/core/service-requests";
import type { StorageRequest } from "@sidecut/contracts/storage";
import type * as LegacyStorageModule from "../../../../../packages/platform-browser/src/legacy-storage";
import { createArchive } from "@sidecut/core/archive";

vi.mock("@sidecut/platform-browser/writer-lock", () => ({ acquireProjectWriter: vi.fn() }));
vi.mock("@sidecut/platform-browser/media", async (importOriginal) => ({
  ...(await importOriginal<typeof MediaModule>()),
  probeLocalFile: vi.fn(),
}));

const segmentStorage = vi.hoisted(() => {
  const rows = new Map<string, string>(),
    files = new Map<string, Uint8Array<ArrayBuffer>>();
  return {
    rows,
    files,
    async request(input: StorageRequest) {
      if (input.type === "read")
        return [...rows]
          .filter(([k]) => input.key == null || k === input.key)
          .map(([key, value]) => ({ key, value }));
      for (const check of input.checks)
        if ((rows.get(check.key) ?? null) !== check.value)
          throw new Error("Concurrent storage change");
      for (const write of input.writes) {
        if (write.value == null) rows.delete(write.key);
        else rows.set(write.key, write.value);
      }
      return [];
    },
    async putFile(bytes: Uint8Array) {
      const key = crypto.randomUUID();
      files.set(key, bytes.slice());
      return key;
    },
    async getFile(key: string) {
      const bytes = files.get(key);
      if (!bytes) throw new Error("Missing test file");
      return bytes;
    },
  };
});
vi.mock("../../../../../packages/platform-browser/src/legacy-storage", async (importOriginal) => ({
  ...(await importOriginal<typeof LegacyStorageModule>()),
  migrateLibrary: async () => segmentStorage,
}));

describe("persistent browser session", () => {
  let saved: ProjectFile | null;
  let failSave: boolean;
  const sessions: BrowserProjectSession[] = [];
  const release = vi.fn();
  const resources = new Map();
  const store = {
    ensureCurrent: async (create: () => ProjectFile) => (saved ??= create()),
    load: async () => saved,
    save: async (file: ProjectFile) => {
      if (failSave) throw new Error("Storage quota exceeded");
      saved = file;
    },
    importProject: async (file: ProjectFile) => {
      saved = file;
    },
    resource: async (_project: string, id: string) => resources.get(id) ?? null,
    putResource: async (_project: string, id: string, resource: unknown) => {
      resources.set(id, resource);
    },
    resources: async () => [...resources].map(([key, resource]) => ({ key, resource })),
    close: vi.fn(),
  };
  const session = () => {
    const value = new BrowserProjectSession();
    sessions.push(value);
    return value;
  };
  const rename = (value: BrowserProjectSession, name: string) =>
    value.apply({ commands: [{ updateProject: { patch: { name } } }] });

  beforeEach(() => {
    saved = null;
    failSave = false;
    resources.clear();
    segmentStorage.rows.clear();
    segmentStorage.files.clear();
    release.mockClear();
    const deliveryFiles = new Map<string, Blob>();
    const deliveryRows = new Map<string, string>();
    vi.spyOn(DurableStorage, "open").mockResolvedValue({
      request: async (request: StorageRequest) => {
        if (request.type === "read")
          return [...deliveryRows]
            .filter(([key]) => request.key === undefined || request.key === key)
            .map(([key, value]) => ({ key, value }));
        for (const check of request.checks)
          if ((deliveryRows.get(check.key) ?? null) !== check.value) throw new Error("conflict");
        for (const write of request.writes)
          if (write.value === null) deliveryRows.delete(write.key);
          else deliveryRows.set(write.key, write.value);
        return [];
      },
      putBlob: async (blob: Blob) => {
        const id = crypto.randomUUID();
        deliveryFiles.set(id, blob);
        return id;
      },
      getBlob: async (id: string, type = "", name?: string, lastModified = 0) => {
        const blob = deliveryFiles.get(id);
        if (!blob) throw new Error("missing");
        return name === undefined ? blob : new File([blob], name, { type, lastModified });
      },
      removeFile: async (id: string) => {
        deliveryFiles.delete(id);
      },
    } as unknown as DurableStorage);
    vi.spyOn(BrowserProjectStore, "open").mockResolvedValue(
      store as unknown as BrowserProjectStore,
    );
    vi.mocked(acquireProjectWriter).mockResolvedValue(release);
  });
  afterEach(async () => {
    await Promise.all(sessions.splice(0).map((value) => value.close()));
    vi.restoreAllMocks();
  });

  it.each(["probe", "hydrate"] as const)(
    "discards a fresh adoption when %s fails without changing the recording or project",
    async (failure) => {
      const value = session();
      await value.start();
      const original = value.getSnapshot().project;
      const id = "33333333-3333-4333-8333-333333333333";
      const recording = {
        id,
        projectID: "source",
        source: "microphone" as const,
        createdAt: "2026-01-01",
        status: "ready" as const,
        encoder: "aac",
        elapsedSeconds: 2,
        bytes: 1,
        tracks: [{ kind: "audio" as const, startSeconds: 0, durationSeconds: 2 }],
        error: null,
      };
      const library = [structuredClone(recording)];
      const remove = vi.fn(async () => {});
      const removeEntry = vi.fn(async () => {});
      const bridge = {
        nativeRecordingList: async () => library,
        nativeRecordingAdopt: async () => ({
          id,
          name: "capture.m4a",
          type: "audio/mp4",
          bytes: 1,
          lastModified: 0,
        }),
        storageFileSize: async () => 1,
        storageFileRead: async () =>
          failure === "hydrate" ? new Uint8Array() : new Uint8Array([1]),
        storageRemoveFile: remove,
        projectFlush: async () => {},
      };
      let contents = new File([], id);
      const directory = {
        getFileHandle: async () => ({
          getFile: async () => contents,
          createWritable: async () => ({
            write: async (bytes: Uint8Array) => {
              contents = new File([new Uint8Array(bytes)], id);
            },
            close: async () => {},
            abort: async () => {},
          }),
        }),
        removeEntry,
      };
      vi.stubGlobal("window", { sidecutDesktop: bridge });
      vi.stubGlobal("navigator", {
        storage: { getDirectory: async () => ({ getDirectoryHandle: async () => directory }) },
      });
      Object.defineProperty(value, "native", { value: bridge });
      if (failure === "probe")
        vi.mocked(probeLocalFile).mockRejectedValueOnce(new Error("probe failed"));
      try {
        await expect(value.importNativeRecording(id, "new-project")).rejects.toThrow(
          failure === "probe" ? "probe failed" : "truncated",
        );
        expect(remove).toHaveBeenCalledWith(id);
        expect(removeEntry).toHaveBeenCalledWith(id);
        expect(library).toEqual([recording]);
        expect(value.getSnapshot().project).toEqual(original);
      } finally {
        vi.unstubAllGlobals();
      }
    },
  );

  it.each(["media", "new-project"] as const)(
    "retains an adopted file after resource commit when %s save fails",
    async (mode) => {
      const value = session();
      await value.start();
      const original = value.getSnapshot().project;
      const id =
        mode === "media"
          ? "44444444-4444-4444-8444-444444444444"
          : "55555555-5555-4555-8555-555555555555";
      const recording = {
        id,
        projectID: "source",
        source: "microphone" as const,
        createdAt: "2026-01-01",
        status: "ready" as const,
        encoder: "aac",
        elapsedSeconds: 2,
        bytes: 1,
        tracks: [{ kind: "audio" as const, startSeconds: 0, durationSeconds: 2 }],
        error: null,
      };
      const remove = vi.fn(async () => {});
      const file = new File(["x"], "capture.m4a", { type: "audio/mp4" });
      const bridge = {
        nativeRecordingList: async () => [recording],
        nativeRecordingAdopt: async () => ({
          id,
          name: file.name,
          type: file.type,
          bytes: 1,
          lastModified: 0,
        }),
        storageFileSize: async () => 1,
        storageFileRead: async () => new Uint8Array([120]),
        storageRemoveFile: remove,
        projectFlush: async () => {
          throw new Error("flush failed");
        },
      };
      vi.stubGlobal("window", { sidecutDesktop: bridge });
      vi.stubGlobal("navigator", {
        storage: {
          getDirectory: async () => ({
            getDirectoryHandle: async () => ({
              getFileHandle: async () => ({ getFile: async () => file }),
            }),
          }),
        },
      });
      Object.defineProperty(value, "native", { value: bridge });
      vi.mocked(probeLocalFile).mockResolvedValueOnce({
        item: {
          id: "native",
          path: file.name,
          fingerprint: "same",
          kind: "audio",
          role: "other",
          hasVideo: false,
          hasAudio: true,
        },
        resource: { file, state: "available", detail: "ready" },
      });
      if (mode === "new-project")
        vi.spyOn(store, "importProject").mockRejectedValueOnce(new Error("project save failed"));
      try {
        await expect(value.importNativeRecording(id, mode)).rejects.toThrow(
          mode === "media" ? "flush failed" : "project save failed",
        );
        expect(resources.has("native")).toBe(true);
        expect(remove).not.toHaveBeenCalled();
        if (mode === "new-project") expect(value.getSnapshot().project).toEqual(original);
      } finally {
        vi.unstubAllGlobals();
      }
    },
  );

  it("imports native media once and retains its source metadata across save retry", async () => {
    const value = session();
    await value.start();
    const id = "a32e4567-e89b-42d3-a456-426614174000";
    const recording = {
      id,
      projectID: "source",
      source: "microphone" as const,
      createdAt: "2026-01-01",
      status: "ready" as const,
      encoder: "aac",
      elapsedSeconds: 2,
      bytes: 1,
      tracks: [{ kind: "audio" as const, startSeconds: 0, durationSeconds: 2 }],
      error: null,
    };
    const file = new File(["x"], "capture.m4a", { type: "audio/mp4" });
    Object.defineProperty(value, "native", {
      value: {
        nativeRecordingRead: async () => ({
          recording,
          name: file.name,
          type: "audio/mp4",
          bytes: new Uint8Array([1]),
        }),
        projectFlush: async () => {
          if (failSave) throw new Error("quota");
        },
      },
    });
    vi.mocked(probeLocalFile).mockResolvedValue({
      item: {
        id: "native",
        path: file.name,
        fingerprint: "same",
        kind: "audio",
        role: "other",
        hasVideo: false,
        hasAudio: true,
      },
      resource: { file, state: "available", detail: "ready" },
    });
    failSave = true;
    await expect(value.importNativeRecording(id, "media")).rejects.toThrow("quota");
    failSave = false;
    await value.importNativeRecording(id, "media");
    expect(value.getSnapshot().project.media).toHaveLength(1);
    expect(value.getSnapshot().project.media[0]?.nativeRecording).toMatchObject({
      id,
      tracks: recording.tracks,
    });
  });

  it("stages a native project with aligned linked tracks before replacing the current project", async () => {
    const value = session();
    await value.start();
    const id = "a32e4567-e89b-42d3-a456-426614174000";
    const recording = {
      id,
      projectID: "source",
      source: "screen" as const,
      createdAt: "2026-01-01",
      status: "ready" as const,
      encoder: "libx264",
      elapsedSeconds: 3,
      bytes: 1,
      tracks: [
        { kind: "video" as const, startSeconds: 1, durationSeconds: 2 },
        { kind: "audio" as const, startSeconds: 1.5, durationSeconds: 1.5 },
      ],
      error: null,
    };
    const file = new File(["x"], "capture.mp4", { type: "video/mp4" });
    Object.defineProperty(value, "native", {
      value: {
        nativeRecordingRead: async () => ({
          recording,
          name: file.name,
          type: "video/mp4",
          bytes: new Uint8Array([1]),
        }),
        projectFlush: async () => {},
      },
    });
    const item = {
      id: "native",
      path: file.name,
      fingerprint: "same",
      kind: "video" as const,
      role: "other" as const,
      hasVideo: true,
      hasAudio: true,
      duration: 2.8,
    };
    vi.mocked(probeLocalFile)
      .mockResolvedValueOnce({ item, resource: { file, state: "unsupported", detail: "bad" } })
      .mockResolvedValue({ item, resource: { file, state: "available", detail: "ready" } });
    const original = value.getSnapshot().project.id;
    await expect(value.importNativeRecording(id, "new-project")).rejects.toThrow("bad");
    expect(value.getSnapshot().project.id).toBe(original);
    await value.importNativeRecording(id, "new-project");
    const project = value.getSnapshot().project;
    const video = project.videoTracks[0]!.clips[0]!,
      audio = project.audioTracks[0]!.clips[0]!;
    expect([video.start.seconds, audio.start.seconds, audio.sourceStart.seconds]).toEqual([
      0, 0.5, 1.5,
    ]);
    expect(video.linkGroup).toBe(audio.linkGroup);
    expect(video.duration.seconds).toBeCloseTo(1.8);
    expect(audio.duration.seconds).toBeCloseTo(1.3);
    expect(saved?.project.media).toHaveLength(1);
  });

  it("does not publish a recording project if resource staging fails", async () => {
    const value = session();
    await value.start();
    const id = "a32e4567-e89b-42d3-a456-426614174000";
    const recording = {
      id,
      projectID: "source",
      source: "microphone" as const,
      createdAt: "2026-01-01",
      status: "ready" as const,
      encoder: "aac",
      elapsedSeconds: 2,
      bytes: 1,
      tracks: [{ kind: "audio" as const, startSeconds: 0, durationSeconds: 2 }],
      error: null,
    };
    const file = new File(["x"], "capture.m4a", { type: "audio/mp4" });
    Object.defineProperty(value, "native", {
      value: {
        nativeRecordingRead: async () => ({
          recording,
          name: file.name,
          type: "audio/mp4",
          bytes: new Uint8Array([1]),
        }),
      },
    });
    vi.mocked(probeLocalFile).mockResolvedValue({
      item: {
        id: "native",
        path: file.name,
        fingerprint: "same",
        kind: "audio",
        role: "other",
        hasVideo: false,
        hasAudio: true,
      },
      resource: { file, state: "available", detail: "ready" },
    });
    const original = value.getSnapshot().project.id;
    vi.spyOn(store, "putResource").mockRejectedValueOnce(new Error("disk full"));
    await expect(value.importNativeRecording(id, "new-project")).rejects.toThrow("disk full");
    expect(value.getSnapshot().project.id).toBe(original);
  });

  it("rejects a native read when the session closes while it is pending", async () => {
    const value = session();
    await value.start();
    let finish!: (value: never) => void;
    Object.defineProperty(value, "native", {
      value: {
        nativeRecordingRead: () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      },
    });
    const pending = value.importNativeRecording("id", "media");
    await value.close();
    finish({} as never);
    await expect(pending).rejects.toThrow("closed");
    expect(resources.size).toBe(0);
  });

  it("binds capture to the starting project and stops it when that project is replaced", async () => {
    const value = session();
    await value.start();
    const projectID = value.getSnapshot().project.id;
    const start = vi.spyOn(value.recording, "start").mockResolvedValue();
    await value.startRecording({ source: "microphone", microphone: false });
    expect(start).toHaveBeenCalledWith({ source: "microphone", microphone: false }, projectID);
    expect(value.recordingProjectID).toBe(projectID);
    vi.spyOn(value.recording, "getSnapshot").mockReturnValue({
      status: "recording",
      startedAt: 0,
      bytes: 0,
    });
    const stop = vi.spyOn(value.recording, "stop").mockImplementation(() => {});
    await value.createProject();
    expect(value.getSnapshot().project.id).not.toBe(projectID);
    expect(stop).toHaveBeenCalled();
    expect(value.recordingProjectID).toBe(projectID);
  });

  it("does not request recording permissions before the project is writable", async () => {
    const value = session();
    const start = vi.spyOn(value.recording, "start");
    await expect(value.startRecording({ source: "camera", microphone: false })).rejects.toThrow(
      "read-only",
    );
    expect(start).not.toHaveBeenCalled();
  });

  it("retains completed recording data after save failure and retries without duplicate media", async () => {
    const value = session();
    await value.start();
    const file = new File(["synthetic recording"], "recording.webm", { type: "audio/webm" });
    value.recordingProjectID = value.getSnapshot().project.id;
    vi.spyOn(value.recording, "getSnapshot").mockReturnValue({ status: "ready", file });
    const discard = vi.spyOn(value.recording, "discard");
    vi.mocked(probeLocalFile).mockResolvedValue({
      item: {
        id: "recorded",
        path: file.name,
        fingerprint: "recording",
        kind: "audio",
        role: "other",
        hasVideo: false,
        hasAudio: true,
      },
      resource: { file, state: "available", detail: "Local recording" },
    });
    failSave = true;
    await expect(value.importRecording()).rejects.toThrow("quota");
    expect(discard).not.toHaveBeenCalled();
    expect(value.recording.getSnapshot()).toEqual({ status: "ready", file });
    failSave = false;
    await value.importRecording();
    expect(discard).toHaveBeenCalledOnce();
    expect(saved?.project.media).toHaveLength(1);
    expect(value.getSnapshot().project.media).toHaveLength(1);
  });

  it("refuses to import a recording into a replacement project", async () => {
    const value = session();
    await value.start();
    value.recordingProjectID = "previous-project";
    vi.spyOn(value.recording, "getSnapshot").mockReturnValue({
      status: "ready",
      file: new File(["recording"], "old.webm"),
    });
    const discard = vi.spyOn(value.recording, "discard");
    await expect(value.importRecording()).rejects.toThrow("original project");
    expect(value.getSnapshot().project.media).toHaveLength(0);
    expect(discard).not.toHaveBeenCalled();
  });

  it("captures queued export bounds and rejects ranges outside the sequence", async () => {
    const value = session();
    await value.start();
    await value.apply({
      commands: [
        {
          insertClip: {
            trackID: "trk_video_0",
            clip: {
              id: "solid",
              duration: 2,
              content: { solid: { color: { r: 0, g: 0, b: 1, a: 1 } } },
            },
          },
        },
      ],
    });
    const render = vi.spyOn(value, "exportWebM").mockResolvedValue(new Blob(["video"]));
    let finish!: (blob: Blob) => void;
    value.exports.enqueue(
      "blocker",
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const range = { from: 0.5, to: 1.25 };
    const id = value.queueExport(null, "webm", range);
    range.from = 1;
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    finish(new Blob(["first"]));
    await vi.waitFor(() =>
      expect(value.exports.getSnapshot().find((entry) => entry.id === id)?.status).toBe("done"),
    );
    expect(render).toHaveBeenCalledWith(
      expect.any(AbortSignal),
      expect.any(Function),
      null,
      "webm",
      { from: 0.5, to: 1.25 },
      expect.objectContaining({ id: value.getSnapshot().project.id }),
      expect.any(Function),
    );
    expect(value.exports.getSnapshot().find((entry) => entry.id === id)?.name).toContain(
      "0.500-1.250s",
    );
    for (const invalid of [
      { from: -1, to: 1 },
      { from: 1, to: 1 },
      { from: 0, to: 3 },
      { from: NaN, to: 1 },
    ])
      expect(() => value.queueExport(null, "wav", invalid)).toThrow("inside the sequence");
    expect(value.exports.getSnapshot()).toHaveLength(2);
  });

  it("renders the frozen snapshot after the project revision changes", async () => {
    const value = session();
    await value.start();
    let finish!: (blob: Blob) => void;
    value.exports.enqueue(
      "blocker",
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const render = vi.spyOn(value, "exportWebM").mockResolvedValue(new Blob(["video"]));
    await value.apply({
      commands: [
        {
          insertClip: {
            trackID: "trk_video_0",
            clip: {
              id: "duration",
              duration: 1,
              content: { solid: { color: { r: 0, g: 0, b: 0, a: 1 } } },
            },
          },
        },
      ],
    });
    const original = value.getSnapshot().project;
    const id = value.queueExport();
    await rename(value, "Changed after queueing");
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    finish(new Blob(["first"]));
    await vi.waitFor(() =>
      expect(value.exports.getSnapshot().find((entry) => entry.id === id)).toMatchObject({
        status: "done",
      }),
    );
    expect(render).toHaveBeenCalledWith(
      expect.any(AbortSignal),
      expect.any(Function),
      null,
      "webm",
      expect.any(Object),
      original,
      expect.any(Function),
    );
    expect(value.getSnapshot().project.name).toBe("Changed after queueing");
  });
  it("guards edits during queued audio rendering and releases the guard after cancellation", async () => {
    const service = await import("@sidecut/platform-browser/wav-export");
    const render = vi.spyOn(service, "renderWAV").mockImplementation(
      async (_project, _resource, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        }),
    );
    const value = session();
    await value.start();
    await value.apply({
      commands: [
        {
          insertClip: {
            trackID: "trk_video_0",
            clip: {
              id: "duration",
              duration: 1,
              content: { solid: { color: { r: 0, g: 0, b: 0, a: 1 } } },
            },
          },
        },
      ],
    });
    const id = value.queueExport(null, "wav");
    await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(1));
    expect(value.getSnapshot().busy).toBe(true);
    expect(() => rename(value, "Blocked while exporting")).toThrow("current file operation");
    value.exports.cancel(id);
    await vi.waitFor(() =>
      expect(value.exports.getSnapshot().find((entry) => entry.id === id)?.status).toBe(
        "cancelled",
      ),
    );
    expect(value.getSnapshot().busy).toBe(false);
    expect(value.jobs.getSnapshot()).toMatchObject([{ id: "export", status: "cancelled" }]);
    await rename(value, "Editable again");
    expect(value.getSnapshot().project.name).toBe("Editable again");
  });

  it("restores archive source copies without their original paths", async () => {
    const value = session();
    await value.start();
    const file = decodeProjectFile({
      revision: 0,
      project: {
        id: "prj_archive",
        media: [{ id: "med_archive", path: "C:/gone/source.wav", kind: "audio" }],
      },
    });
    const bytes = createArchive(file, [
      {
        key: "med_archive",
        name: "source.wav",
        type: "audio/wav",
        bytes: new TextEncoder().encode("source bytes"),
      },
    ]);
    await value.openProject(new File([bytes.slice().buffer], "portable.sidecut"));
    expect(await (await value.resource("med_archive"))!.file.text()).toBe("source bytes");
    expect(value.getSnapshot().project.media[0]!.path).toBe("media/0-source.wav");
  });

  it("opens Filmora folder metadata and leaves the current project intact on malformed import", async () => {
    const value = session();
    await value.start();
    const file = (path: string, body: unknown) => {
      const item = new File([JSON.stringify(body)], path.split("/").at(-1)!);
      Object.defineProperty(item, "webkitRelativePath", {
        value: `项目.wfp.dir/ProjectFolder/${path}`,
      });
      return item;
    };
    const info = file("project_info.json", {
      timeline_mediaId: "main",
      project_file_name: "Folder project",
    });
    const timeline = file("Medias/main/timeline.wesproj", {
      timelineInfos: [{ timelineId: 1, userData: [{ key: 3, data: "bWFpbg==" }], trackInfos: [] }],
    });
    const extra = file("Medias/main/extra.json", {
      allMarkersInfo: { main: [{ position: 10000000, name: "Start" }] },
    });
    const source = file("footage/movie.mov", "ignored source bytes");
    await value.openFilmoraFolder([info, timeline, extra, source]);
    expect(value.getSnapshot().project.name).toBe("Folder project");
    expect(value.getSnapshot().project.markers[0]).toMatchObject({ name: "Start", time: 1 });
    const before = value.getSnapshot().project;
    await expect(
      value.openFilmoraFolder([info, file("Medias/main/timeline.wesproj", {})]),
    ).rejects.toThrow();
    expect(value.getSnapshot().project).toEqual(before);
  });

  it("checks relink identity before replacing resources and preserves IDs and undo", async () => {
    const value = session();
    await value.start();
    const file = decodeProjectFile({
      revision: 0,
      project: {
        id: "prj_relink",
        media: [{ id: "med_relink", path: "old.wav", kind: "audio", fingerprint: "10-1-abcd" }],
      },
    });
    await value.openProject(new File([encodeProjectFile(file)], "relink.tandem"));
    const replacement = new File(["replacement"], "new.wav");
    vi.mocked(probeLocalFile).mockResolvedValue({
      item: {
        id: "new",
        path: "new.wav",
        kind: "audio",
        role: "other",
        fingerprint: "10-2-wrong",
        hasVideo: false,
        hasAudio: true,
      },
      resource: { file: replacement, state: "available", detail: "local" },
    });
    await expect(value.relinkMedia("med_relink", replacement)).rejects.toThrow(/identity/);
    expect(await value.resource("med_relink")).toBeNull();
    vi.mocked(probeLocalFile).mockResolvedValue({
      item: {
        id: "new",
        path: "new.wav",
        kind: "audio",
        role: "other",
        fingerprint: "10-2-abcd",
        hasVideo: false,
        hasAudio: true,
      },
      resource: { file: replacement, state: "available", detail: "local" },
    });
    await value.relinkMedia("med_relink", replacement);
    expect(value.getSnapshot().project.media[0]!.id).toBe("med_relink");
    expect(value.getSnapshot().project.media[0]!.path).toBe("new.wav");
    value.undo();
    expect(value.getSnapshot().project.media[0]!.path).toBe("old.wav");
  });

  it("validates and persists local LUTs independently of project media", async () => {
    const first = session();
    await first.start();
    const invalid = new File(["invalid"], "invalid.cube");
    await expect(first.importLUT(invalid)).rejects.toThrow(/no LUT/);
    expect(await first.resource("lut:invalid.cube")).toBeNull();
    expect(first.getSnapshot().busy).toBe(false);
    const lut = new File(["LUT_1D_SIZE 2\n0 0 0\n1 1 1"], "identity.cube");
    expect(await first.importLUT(lut)).toBe("identity.cube");
    expect(first.getSnapshot().project.media).toHaveLength(0);
    expect(first.getSnapshot().revision).toBe(0);
    await first.close();
    const second = session();
    await second.start();
    expect(await (await second.resource("lut:identity.cube"))!.file.text()).toContain(
      "LUT_1D_SIZE",
    );
  });

  it("saves settings and undo, then restores the last committed snapshot on restart", async () => {
    const first = session();
    await first.start();
    rename(first, "Local study");
    first.apply({ commands: [{ updateSettings: { patch: { width: 1920 } } }] });
    first.undo();
    await first.close();
    const second = session();
    await second.start();
    expect(second.getSnapshot()).toMatchObject({
      revision: 3,
      saveState: "saved",
      project: { name: "Local study", settings: { width: 3840 } },
    });
  });

  it("preserves the previous save on failure and retries the latest in-memory revision", async () => {
    const value = session();
    await value.start();
    failSave = true;
    rename(value, "Unsaved study");
    await expect(value.retrySave()).rejects.toThrow("quota");
    expect(value.getSnapshot().saveState).toBe("error");
    expect(saved?.project.name).toBe("Untitled sequence");
    failSave = false;
    await value.retrySave();
    expect(saved?.project.name).toBe("Unsaved study");
    expect(value.getSnapshot().saveState).toBe("saved");
  });

  it("blocks all mutation entry points without a writer lock and reloads before taking over", async () => {
    vi.mocked(acquireProjectWriter).mockResolvedValueOnce(null);
    const value = session();
    await value.start();
    expect(value.getSnapshot().saveState).toBe("read-only");
    expect(() => rename(value, "Cannot write")).toThrow("read-only");
    expect(() => value.undo()).toThrow("read-only");
    await expect(value.importFiles([new File(["x"], "test.png")])).rejects.toThrow("read-only");
    saved = decodeProjectFile({
      revision: 9,
      project: { id: value.getSnapshot().project.id, name: "Other tab edit" },
    });
    await value.enableEditing();
    expect(value.getSnapshot()).toMatchObject({
      revision: 9,
      readOnly: false,
      project: { name: "Other tab edit" },
    });
  });

  it("does not acquire a writer from an abandoned start during a mount/restart race", async () => {
    let finish!: (store: BrowserProjectStore) => void;
    vi.mocked(BrowserProjectStore.open).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const value = session();
    const abandoned = value.start();
    await value.close();
    await value.start();
    const calls = vi.mocked(acquireProjectWriter).mock.calls.length;
    finish(store as unknown as BrowserProjectStore);
    await abandoned;
    expect(vi.mocked(acquireProjectWriter).mock.calls.length).toBe(calls);
    expect(value.getSnapshot().readOnly).toBe(false);
  });

  it("rejects invalid open without switching the active project and preserves envelope fields", async () => {
    const value = session();
    await value.start();
    const previous = value.getSnapshot().project;
    await expect(
      value.openProject(new File(['{"schemaVersion":999}'], "invalid.tandem")),
    ).rejects.toThrow();
    expect(value.getSnapshot().project).toBe(previous);
    const file = decodeProjectFile({
      revision: 12,
      customEnvelope: { preserved: true },
      project: { id: "prj_opened", name: "Opened study" },
    });
    await value.openProject(new File([encodeProjectFile(file)], "study.tandem"));
    expect(value.getSnapshot()).toMatchObject({ revision: 12, project: { id: "prj_opened" } });
    expect(value.projectFile().customEnvelope).toEqual({ preserved: true });
  });

  it("deduplicates local imports and restores a missing resource without creating another media item", async () => {
    const value = session();
    await value.start();
    const file = new File(["synthetic"], "image.png", { type: "image/png" });
    const item = {
      id: "med_image",
      path: file.name,
      kind: "image" as const,
      role: "image" as const,
      fingerprint: "test",
      hasVideo: true,
      hasAudio: false,
    };
    vi.mocked(probeLocalFile).mockResolvedValue({
      item,
      resource: { file, state: "available", detail: "Local" },
    });
    await value.importFiles([file, file]);
    expect(value.getSnapshot().project.media).toHaveLength(1);
    resources.clear();
    await value.importFiles([file]);
    expect(value.getSnapshot().revision).toBe(1);
    expect(value.getSnapshot().mediaAvailability.med_image?.state).toBe("available");
    expect(JSON.stringify(value.projectFile())).not.toContain("synthetic");
  });
  it("opens unsupported projects read-only without writing or enabling edits", async () => {
    const value = session();
    await value.start();
    const previous = saved;
    await value.openProject(
      new File(
        [JSON.stringify({ revision: 5, project: { schemaVersion: 99, future: true } })],
        "future.tandem",
      ),
    );
    expect(value.getSnapshot().readOnly).toBe(true);
    expect(value.getSnapshot().warnings[0]).toMatch(/Read-only import/);
    expect(saved).toBe(previous);
    await expect(value.enableEditing()).rejects.toThrow(/unsupported/);
    expect(() => rename(value, "bad")).toThrow(/read-only/);
  });
  it("keeps a retried command idempotent after a save and session reopen", async () => {
    const value = session();
    await value.start();
    const batch = {
      label: "Rename",
      author: "agent",
      idempotencyKey: "rename",
      commands: [{ updateProject: { patch: { name: "Saved" } } }],
    };
    const result = value.apply(batch);
    await value.close();
    const reopened = session();
    await reopened.start();
    expect(reopened.apply(batch)).toEqual(result);
    expect(reopened.getSnapshot().revision).toBe(1);
  });
  it("runs segment service contracts through the real session/library with one atomic undoable insertion", async () => {
    const value = session(),
      signal = new AbortController().signal;
    await value.start();
    await value.openProject(
      new File(
        [
          JSON.stringify({
            revision: 0,
            project: {
              id: "segment-service",
              videoTracks: [
                {
                  id: "text",
                  kind: "video",
                  name: "Text",
                  clips: [
                    {
                      id: "title",
                      linkGroup: "pair",
                      start: 0,
                      duration: 2,
                      content: { text: { text: "Original" } },
                    },
                    {
                      id: "partner",
                      linkGroup: "pair",
                      start: 2,
                      duration: 1,
                      content: { text: { text: "Partner" } },
                    },
                  ],
                },
              ],
            },
          }),
        ],
        "source.tandem",
      ),
    );
    const run = (operation: string, request: unknown = {}) =>
      libraryOperation(value, operation, serviceRequest(operation, request), signal);
    const before = encodeProjectFile(value.projectFile());
    await expect(run("save-segment", { name: "Missing" })).rejects.toThrow("Say which clips");
    await expect(
      run("save-segment", { name: "Mixed", clipIDs: ["title", "unknown"] }),
    ).rejects.toThrow();
    await expect(run("save-segment", { name: "Range", from: 10, to: 11 })).rejects.toThrow(
      "No clip",
    );
    expect(encodeProjectFile(value.projectFile())).toBe(before);
    const savedSegment = await run("save-segment", {
      name: "Title",
      clips: "title",
      fields: ["title=Section title"],
    });
    expect(savedSegment).toMatchObject({
      segment: {
        clips: 1,
        duration: 2,
        fields: [{ key: "sectionTitle", defaultValue: "Original" }],
      },
      clipIDs: ["title"],
      copied: [],
      notes: [],
    });
    expect(encodeProjectFile(value.projectFile())).toBe(before);
    await expect(run("save-segment", { name: "Title", clipIDs: ["title"] })).rejects.toThrow(
      "already exists",
    );
    segmentStorage.rows.set("broken", "invalid JSON");
    expect(await run("segments")).toMatchObject({
      exists: true,
      segments: [{ id: "Title", clips: 1 }],
      problems: ["broken: Invalid stored segment."],
    });
    await expect(run("insert-segment", { name: "missing", at: 4 })).rejects.toThrow("not found");
    await expect(
      run("insert-segment", { name: "Title", at: 4, values: { unknown: "No" } }),
    ).rejects.toThrow("no field");
    await expect(
      run("insert-segment", { name: "Title", at: 4, expectedRevision: 100 }),
    ).rejects.toThrow();
    expect(encodeProjectFile(value.projectFile())).toBe(before);
    const inserted = await run("insert-segment", {
      name: "title",
      at: "0:04",
      values: { sectionTitle: "Inserted" },
      label: "Add title",
      author: "agent",
      expectedRevision: 0,
    });
    expect(inserted).toMatchObject({
      at: 4,
      segment: { id: "Title" },
      applied: { revision: 1, label: "Add title", author: "agent", warnings: [] },
    });
    expect(value.getSnapshot().project.videoTracks[0]!.clips.at(-1)!.content.text).toMatchObject({
      text: "Inserted",
    });
    const after = encodeProjectFile(value.projectFile());
    await expect(run("insert-segment", { name: "Title", at: 4 })).rejects.toThrow("already has");
    expect(encodeProjectFile(value.projectFile())).toBe(after);
    value.undo();
    expect(value.getSnapshot().project.videoTracks[0]!.clips).toHaveLength(2);
    value.redo();
    expect(value.getSnapshot().project.videoTracks[0]!.clips).toHaveLength(3);
    const revision = value.getSnapshot().revision;
    await run("save-segment", { name: "Title", clipIDs: ["partner"], replace: true });
    expect(value.getSnapshot().revision).toBe(revision);
    const controller = new AbortController();
    controller.abort();
    await expect(
      libraryOperation(value, "insert-segment", { name: "Title", at: 8 }, controller.signal),
    ).rejects.toThrow();
    expect(value.getSnapshot().revision).toBe(revision);
  });
  it("copies segment files under the committed media IDs and isolates replacement resources", async () => {
    const value = session(),
      signal = new AbortController().signal;
    await value.start();
    await value.openProject(
      new File(
        [
          JSON.stringify({
            revision: 0,
            project: {
              id: "segment-files",
              media: [{ id: "source", kind: "image", path: "source.png" }],
              videoTracks: [
                {
                  id: "image",
                  kind: "video",
                  name: "Image",
                  clips: [
                    {
                      id: "image-clip",
                      start: 0,
                      duration: 1,
                      content: { media: { mediaID: "source" } },
                    },
                  ],
                },
              ],
            },
          }),
        ],
        "source.tandem",
      ),
    );
    const file = (body: string) => ({
      file: new File([body], "source.png", { type: "image/png" }),
      state: "available",
      detail: "Synthetic bytes",
    });
    resources.set("source", file("original"));
    const run = (operation: string, request: unknown) =>
      libraryOperation(value, operation, serviceRequest(operation, request), signal);
    await run("save-segment", { name: "Picture", clipIDs: ["image-clip"] });
    await run("insert-segment", { name: "Picture", at: 3 });
    const first = value.getSnapshot().project.media.find((m) => m.id !== "source")!;
    expect(first.id).not.toBe("source");
    expect(await (await value.resource(first.id))!.file.text()).toBe("original");
    resources.set("source", file("replacement"));
    await run("save-segment", { name: "Picture", clipIDs: ["image-clip"], replace: true });
    await run("insert-segment", { name: "Picture", at: 5 });
    const second = value
      .getSnapshot()
      .project.media.find((m) => m.id !== "source" && m.id !== first.id)!;
    expect(second.path).not.toBe(first.path);
    expect(await (await value.resource(second.id))!.file.text()).toBe("replacement");
    expect(await (await value.resource(first.id))!.file.text()).toBe("original");
    const before = encodeProjectFile(value.projectFile());
    resources.delete("source");
    await expect(
      run("save-segment", { name: "Missing media", clipIDs: ["image-clip"] }),
    ).rejects.toThrow("missing");
    expect(encodeProjectFile(value.projectFile())).toBe(before);
    value.undo();
    expect(value.getSnapshot().project.media).toHaveLength(2);
    value.redo();
    expect(value.getSnapshot().project.media).toHaveLength(3);
    expect(await (await value.resource(second.id))!.file.text()).toBe("replacement");
  });
});
