import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { decodeProjectFile, encodeProjectFile } from "@sidecut/contracts/project";
import type { ProjectFile } from "@sidecut/contracts/project";
import { BrowserProjectStore } from "@sidecut/platform-browser/storage";
import { acquireProjectWriter } from "@sidecut/platform-browser/writer-lock";
import { probeLocalFile } from "@sidecut/platform-browser/media";
import type * as MediaModule from "@sidecut/platform-browser/media";
import { BrowserProjectSession } from "./browser-session";
import { createArchive } from "@sidecut/core/archive";

vi.mock("@sidecut/platform-browser/writer-lock", () => ({ acquireProjectWriter: vi.fn() }));
vi.mock("@sidecut/platform-browser/media", async (importOriginal) => ({
  ...(await importOriginal<typeof MediaModule>()),
  probeLocalFile: vi.fn(),
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
    release.mockClear();
    vi.spyOn(BrowserProjectStore, "open").mockResolvedValue(
      store as unknown as BrowserProjectStore,
    );
    vi.mocked(acquireProjectWriter).mockResolvedValue(release);
  });
  afterEach(async () => {
    await Promise.all(sessions.splice(0).map((value) => value.close()));
    vi.restoreAllMocks();
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
});
