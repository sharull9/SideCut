import { openSQLite } from "./sqlite-storage.ts";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { HostProjectService } from "./project-service.ts";
import { NativeProjectStore } from "./project-store.ts";
import { ProjectAPI } from "./project-api.ts";
import { LocalHTTPService } from "./http-service.ts";

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of cleanup.reverse().splice(0)) await close();
});
async function setup(renderer?: ConstructorParameters<typeof ProjectAPI>[2]) {
  const root = await mkdtemp(join(tmpdir(), "sidecut-review-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const host = new HostProjectService(new NativeProjectStore(join(root, "current.tandem")));
  await host.start();
  cleanup.push(() => host.close());
  const api = new ProjectAPI(host, undefined, renderer);
  const server = new LocalHTTPService(api),
    address = await server.start();
  cleanup.push(() => server.close());
  const discovery = join(root, "endpoint.json");
  await writeFile(discovery, JSON.stringify(address));
  const cli = (...args: string[]) =>
    new Promise<{ code: number | null; out: string; err: string }>((complete, reject) => {
      const child = spawn(
        process.execPath,
        [resolve("scripts/sidecut-cli.mjs"), ...args, "--endpoint-file", discovery],
        { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, windowsHide: true },
      );
      let out = "",
        err = "";
      child.stdout.on("data", (chunk) => (out += chunk));
      child.stderr.on("data", (chunk) => (err += chunk));
      child.once("error", reject);
      child.once("close", (code) => complete({ code, out, err }));
    });
  return { root, host, api, cli };
}

describe("review, watch and CLI host adapters", () => {
  it("checks pending agent ranges and clears them only after durable human review", async () => {
    const { api, host } = await setup(),
      file = JSON.parse(host.snapshot().json);
    await api.handle("apply", {
      author: "human",
      commands: [
        {
          insertClip: {
            trackID: file.project.videoTracks[0].id,
            clip: {
              id: "review-solid",
              duration: 2,
              content: { solid: { color: { r: 0, g: 0, b: 1, a: 1 } } },
            },
          },
        },
      ],
    });
    expect(await api.handle("check", { changed: true, quick: true })).toMatchObject({
      ranges: [],
      frames: 0,
    });
    await api.handle("apply", {
      author: "agent",
      commands: [{ updateClip: { clipID: "review-solid", patch: { name: "Agent change" } } }],
    });
    expect(await api.handle("check", { changed: true, quick: true })).toMatchObject({
      revision: 2,
      ranges: [{ start: 0, duration: 2 }],
      frames: 0,
    });
    await host.flush();
    host.request(
      JSON.stringify({
        type: "markReviewed",
        projectID: file.project.id,
        generation: host.snapshot().generation,
        revision: 2,
      }),
    );
    expect(await api.handle("check", { changed: true, quick: true })).toMatchObject({ ranges: [] });
    await expect(api.handle("check", { quick: true, width: 1 })).rejects.toThrow(/width/);
    await expect(api.handle("validate", { from: 0 })).rejects.toThrow(/Unknown/);
  });
  it("sets picture delay with dry-run, stale revision and undo protection", async () => {
    const { api, host } = await setup();
    await api.handle("apply", {
      commands: [
        {
          addMedia: {
            item: {
              id: "camera",
              path: "camera.mp4",
              kind: "video",
              role: "camera",
              hasVideo: true,
              duration: 2,
            },
          },
        },
      ],
    });
    const before = host.snapshot().json;
    expect(
      await api.handle("sync", { delay: 0.08, dryRun: true, expectedRevision: 1 }),
    ).toMatchObject({ revision: 1, applied: { dryRun: true } });
    expect(host.snapshot().json).toBe(before);
    expect(await api.handle("sync", { delay: 0.08, expectedRevision: 1 })).toMatchObject({
      revision: 2,
      files: [{ id: "camera", pictureDelay: 0.08 }],
    });
    await expect(api.handle("sync", { delay: 0, expectedRevision: 1 })).rejects.toThrow("Stale");
    await api.handle("undo", {});
    expect(await api.handle("sync", {})).toMatchObject({
      files: [{ id: "camera", pictureDelay: undefined }],
    });
    await api.handle("sync", { delay: -0.08, makeDefault: true, dryRun: true });
    expect(host.store.cameraPictureDelay()).toBe(0);
    await api.handle("sync", { delay: 0.08, makeDefault: true });
    await api.handle("apply", {
      commands: [
        {
          addMedia: {
            item: {
              id: "new-camera",
              path: "new.mp4",
              kind: "video",
              role: "camera",
              hasVideo: true,
            },
          },
        },
      ],
    });
    expect(await api.handle("sync", {})).toMatchObject({
      defaultDelay: 0.08,
      files: expect.arrayContaining([
        {
          id: "new-camera",
          path: "new.mp4",
          role: "camera",
          pictureDelay: 0.08,
          pictureDelayCorrected: undefined,
        },
      ]),
    });
    await expect(api.handle("sync", { delay: 80 })).rejects.toThrow(/one second/);
    await expect(api.handle("sync", { makeDefault: true })).rejects.toThrow(/delay/);
  });
  it("runs CLI create/edit/inspect with strict fields and stable error exits", async () => {
    const { api, host, cli } = await setup();
    expect((await cli("new", "--name", "CLI project")).code).toBe(2);
    const created = await cli("new", "--name", "CLI project", "--expected-revision", "0");
    expect(created.code, created.err).toBe(0);
    expect(JSON.parse(created.out).name).toBe("CLI project");
    const edited = await cli(
      "apply",
      "--commands",
      JSON.stringify([{ updateProject: { patch: { name: "CLI edited" } } }]),
      "--expected-revision",
      "0",
    );
    expect(edited.code, edited.err).toBe(0);
    expect(JSON.parse((await cli("status", "--json")).out)).toMatchObject({
      name: "CLI edited",
      revision: 1,
    });
    expect(JSON.parse(host.snapshot().json).project.name).toBe("CLI edited");
    expect((await cli("apply", "--commands", "[]", "--expected-revision", "0")).code).toBe(4);
    expect((await cli("check")).code).toBe(2);
    expect((await cli("status", "--constructor", "bad")).code).toBe(2);
    expect((await cli("assets", "show", "--id", "missing")).code).toBe(3);
    expect((await cli("effects", "--type", "missing")).code).toBe(5);
    expect(await api.handle("schema", {})).toMatchObject({
      operations: { "assets-search": { online: "boolean" }, watch: { revision: "integer" } },
    });
  });
  it("watches changes, resumes after a revision, times out and cancels without editing", async () => {
    const { api, host } = await setup();
    const waiting = api.handle("watch", { revision: 0, timeout: 1 });
    await api.handle("apply", { commands: [{ updateProject: { patch: { name: "Changed" } } }] });
    expect(await waiting).toMatchObject({
      changed: true,
      revision: 1,
      resync: false,
      events: [{ kind: "edit", revision: 1 }],
    });
    expect(await api.handle("watch", { revision: 0 })).toMatchObject({
      changed: true,
      revision: 1,
    });
    await api.handle("undo", {});
    await api.handle("redo", {});
    expect(await api.handle("watch", { revision: 0 })).toMatchObject({
      events: [
        { seq: 1, kind: "edit" },
        { seq: 2, kind: "undo" },
        { seq: 3, kind: "redo" },
      ],
    });
    expect(await api.handle("watch", { revision: 3, timeout: 0.01 })).toMatchObject({
      changed: false,
      revision: 3,
    });
    const controller = new AbortController();
    const cancelled = api.handle("watch", {}, controller.signal);
    controller.abort();
    await expect(cancelled).rejects.toThrow("cancelled");
    expect(JSON.parse(host.snapshot().json).revision).toBe(3);
    const generation = host.snapshot().generation;
    await api.handle("new", { expectedRevision: 3, name: "Replacement" });
    expect(await api.handle("watch", { revision: 1, generation, timeout: 0.01 })).toMatchObject({
      changed: true,
      revision: 0,
    });
    expect(await api.handle("watch", { timeout: 0 })).toMatchObject({ changed: false, events: [] });
  });
  it("lists and resolves marker comments through shared edits and validates warnings", async () => {
    const { api } = await setup();
    await api.handle("apply", {
      commands: [
        { addMarker: { marker: { id: "comment", time: 1, name: "Fix this", kind: "comment" } } },
      ],
    });
    expect(await api.handle("comments", {})).toMatchObject({
      revision: 1,
      comments: [{ id: "comment", text: "Fix this", time: 1 }],
    });
    await api.handle("apply", { commands: [{ removeMarker: { markerID: "comment" } }] });
    expect(await api.handle("comments", {})).toMatchObject({ comments: [] });
    await api.handle("undo", {});
    expect(await api.handle("comments", {})).toMatchObject({ comments: [{ id: "comment" }] });
    expect(await api.handle("validate", {})).toMatchObject({ valid: true });
    await expect(api.handle("check", { quick: true })).rejects.toThrow("Nothing to check");
    await expect(api.handle("check", { quick: true, cuts: true })).rejects.toThrow(
      "does not take quick",
    );
  });
  it("opens/imports safely with revision guards and keeps a project backup", async () => {
    const { root, api, host, cli } = await setup();
    await writeFile(
      join(root, "open.tandem"),
      JSON.stringify({ revision: 0, project: { id: "opened", name: "Opened" } }),
    );
    expect(await api.handle("open", { path: "open.tandem", expectedRevision: 0 })).toMatchObject({
      name: "Opened",
    });
    const db = openSQLite(host.store.databasePath);
    try {
      const backup = db.repository.request({
        type: "read",
        collection: "previous",
        key: "host",
      })[0]!.value;
      expect(JSON.parse(backup).project.name).toBe("Untitled sequence");
    } finally {
      db.database.close();
    }
    await expect(
      api.handle("open", { path: "../escape.tandem", expectedRevision: 0 }),
    ).rejects.toThrow();
    expect(await api.handle("sync", { files: [] })).toMatchObject({ files: [], defaultDelay: 0 });
    await writeFile(
      join(root, "recipe.json"),
      JSON.stringify({
        edl: { segments: [{ start: 0, end: 1, layout: "cam" }] },
        recipe: { name: "Imported EDL", takes: [{ start: 0, camera: "camera.mov" }] },
      }),
    );
    expect(
      await api.handle("import-edl", { path: "recipe.json", expectedRevision: 0 }),
    ).toMatchObject({ name: "Imported EDL" });
    await writeFile(
      join(root, "basic.wfp"),
      await readFile(resolve("tests/fixtures/tandem/filmora-basic.wfp")),
    );
    const revision = JSON.parse(host.snapshot().json).revision;
    expect(
      await api.handle("import-filmora", { path: "basic.wfp", expectedRevision: revision }),
    ).toMatchObject({ revision: expect.any(Number) });
    const fixture = JSON.parse(
      await readFile(resolve("tests/fixtures/tandem/filmora-mappings.json"), "utf8"),
    );
    const folder = join(root, "电影.wfp.dir/ProjectFolder");
    await mkdir(join(folder, "Medias/main"), { recursive: true });
    for (const [path, body] of Object.entries({
      "project_info.json": fixture.info,
      "Medias/main/timeline.wesproj": fixture.document,
      "Medias/main/extra.json": fixture.extra,
    }))
      await writeFile(join(folder, path), JSON.stringify(body));
    const kept = await cli(
      "import-filmora",
      "--path",
      "电影.wfp.dir",
      "--expected-revision",
      String(JSON.parse(host.snapshot().json).revision),
      "--keep-levels",
    );
    expect(kept.code).toBe(0);
    expect(JSON.parse(kept.out).name).toBe("Filmora mapping acceptance");
    expect(JSON.parse(host.snapshot().json).project.audioTracks[0].clips[0].audio).toMatchObject({
      gainDB: -1,
      normalizeTo: -24,
    });
  });
  it("accepts pinned positional segment commands, repeated fields/values and readable output", async () => {
    const calls: { operation: string; input: Record<string, unknown> }[] = [];
    const segment = {
      id: "Intro",
      name: "Intro",
      folder: "indexeddb:sidecut-segments/Intro",
      clips: 1,
      duration: 2,
      tracks: ["Text"],
      fields: [{ key: "title", label: "Title", defaultValue: "Original" }],
      files: [],
      missing: [],
      savedAt: "",
      savedFrom: "Source",
    };
    const { cli, root, host } = await setup({
      ready: () => false,
      screenshot: async () => new Uint8Array(),
      run: async (operation, input) => {
        calls.push({ operation, input });
        if (operation === "save-segment")
          return { segment, clipIDs: ["a", "b"], copied: [], notes: [] };
        if (operation === "segments")
          return {
            exists: true,
            folder: "indexeddb:sidecut-segments",
            segments: [segment],
            problems: [],
          };
        return {
          segment,
          at: input.at,
          applied: { revision: 1, label: "Add Intro", warnings: [], createdIDs: [] },
        };
      },
    });
    const save = await cli(
      "segments",
      "save",
      "Intro",
      "--clips",
      "a,b",
      "--field",
      "a=Title",
      "--field",
      "b=Subtitle",
      "--json",
    );
    expect(save.code).toBe(0);
    expect(JSON.parse(save.out)).toMatchObject({ segment: { id: "Intro" }, notes: [] });
    expect(calls.at(-1)).toEqual({
      operation: "save-segment",
      input: { name: "Intro", clips: ["a", "b"], fields: ["a=Title", "b=Subtitle"] },
    });
    const legacySave = await cli(
      "segments",
      "save",
      "--name",
      "Intro",
      "--clip-ids",
      '["a"]',
      "--json",
    );
    expect(legacySave.code).toBe(0);
    expect(calls.at(-1)?.input).toEqual({ name: "Intro", clipIDs: ["a"] });
    const insert = await cli(
      "segments",
      "insert",
      "Intro",
      "--at",
      "0:04",
      "--value",
      "title=New",
      "--value",
      "subtitle=Second",
      "--json",
    );
    expect(insert.code).toBe(0);
    expect(calls.at(-1)).toEqual({
      operation: "insert-segment",
      input: {
        name: "Intro",
        at: 4,
        values: { title: "New", subtitle: "Second" },
        author: "cli",
      },
    });
    const readable = await cli("segments");
    expect(readable.code).toBe(0);
    expect(readable.out).toContain("Segments in");
    const source = join(root, "request.json");
    await writeFile(source, JSON.stringify({ name: "Intro", at: 8 }));
    const fromFile = await cli("insert-segment", "--input", source, "--json");
    expect(fromFile.code).toBe(0);
    expect(calls.at(-1)?.input).toEqual({ name: "Intro", at: 8, author: "agent" });
    const stale = await cli(
      "segments",
      "insert",
      "Intro",
      "--at",
      "8",
      "--expect",
      "999",
      "--json",
    );
    expect(stale.code).toBe(4);
    expect(JSON.parse(stale.err)).toMatchObject({ error: { code: "staleRevision" } });
    const selected = await cli("segments", "list", "--project", host.store.path, "--json");
    expect(selected.code).toBe(0);
    const other = join(root, "other.tandem");
    await writeFile(other, "{}");
    const count = calls.length;
    const wrong = await cli(
      "segments",
      "insert",
      "Intro",
      "--at",
      "9",
      "--project",
      other,
      "--json",
    );
    expect(wrong.code).toBe(2);
    expect(wrong.err).toContain("different project");
    expect(calls).toHaveLength(count);
  });
});
