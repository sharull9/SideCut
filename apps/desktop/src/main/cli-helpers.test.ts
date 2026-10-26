import { afterEach, expect, it } from "vite-plus/test";
import { mkdtemp, readFile, writeFile, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { parseArguments } from "../../../../scripts/cli-foundation.mjs";
import { prepareQueryCommand, queryText } from "../../../../scripts/cli-query-commands.mjs";
import contract from "../../../../tests/fixtures/tandem/cli-helpers.json";
import cardsContract from "../../../../tests/fixtures/tandem/cli-cards.json";
import { HostProjectService } from "./project-service.ts";
import { NativeProjectStore } from "./project-store.ts";
import { ProjectAPI } from "./project-api.ts";
import { LocalHTTPService } from "./http-service.ts";
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of cleanup.reverse().splice(0)) await close();
});
it("matches pinned helper text including preview copy wording", () => {
  for (const example of contract.examples)
    expect(queryText(example.operation, example.result)).toBe(example.text);
  for (const example of cardsContract.examples)
    expect(queryText("cards", example.result)).toBe(example.text);
});
it("maps native helper flags and protects preview defaults", () => {
  const captions = prepareQueryCommand(
    parseArguments(["captions", "--max-words", "2", "--y", "0.8"]),
  );
  expect(captions?.flags.get("words")).toBe("2");
  expect(captions?.prepare({})).toMatchObject({ apply: contract.defaults.apply });
  const tighten = prepareQueryCommand(
    parseArguments(["tighten", "--protect", "1,2", "--protect", "3", "--mid-min", "0.5"]),
  );
  expect(tighten?.flags.get("protect")).toEqual(["1,2", "3"]);
  const cards = prepareQueryCommand(
    parseArguments([
      "project",
      "cards",
      "--marker",
      "a,b",
      "--marker",
      "b",
      "--no-sounds",
      "--insert",
    ]),
  );
  expect(cards?.flags.get("markers")).toBe('["a,b","b"]');
  expect(cards?.flags.get("sounds")).toBe("false");
  expect(cards?.flags.get("insert")).toBe(true);
  expect(cards?.prepare({})).toMatchObject({ apply: false });
  expect(
    prepareQueryCommand(parseArguments(["short", "--copy", "-o", "portrait"]))?.flags.get(
      "copy-path",
    ),
  ).toBe("portrait.tandem");
  for (const args of [
    ["short", "-o", "wrong"],
    ["join", "extra"],
    ["pauses", "--apply"],
    ["captions", "--max-words", "2", "--words"],
    ["cards", "extra"],
    ["cards", "--unknown"],
    ["cards", "--marker", "a", "--markers", "[]"],
    ["cards", "--no-sounds", "--sounds", "true"],
  ])
    expect(() => prepareQueryCommand(parseArguments(args))).toThrow();
});
it("runs editing helpers and cards through the authoritative host", async () => {
  const root = await mkdtemp(join(tmpdir(), "sidecut-cli-helpers-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const host = new HostProjectService(new NativeProjectStore(join(root, "current.tandem")));
  await host.start();
  cleanup.push(() => host.close());
  const api = new ProjectAPI(host),
    server = new LocalHTTPService(api),
    endpoint = await server.start();
  cleanup.push(() => server.close());
  const discovery = join(root, "endpoint.json");
  await writeFile(discovery, JSON.stringify(endpoint));
  const initial = JSON.parse(host.snapshot().json),
    track = initial.project.audioTracks[0].id;
  await api.handle("apply", {
    commands: [
      {
        addMedia: {
          item: { id: "voice", kind: "audio", path: "voice.wav", hasAudio: true, duration: 4 },
        },
      },
      {
        insertClip: {
          trackID: track,
          clip: {
            id: "a",
            start: 0,
            duration: 2,
            sourceStart: 0,
            content: { media: { mediaID: "voice" } },
          },
        },
      },
      {
        insertClip: {
          trackID: track,
          clip: {
            id: "b",
            start: 2,
            duration: 2,
            sourceStart: 2,
            content: { media: { mediaID: "voice" } },
          },
        },
      },
    ],
  });
  const cli = (...args: string[]) =>
    new Promise<{ code: number | null; out: string; err: string }>((done, reject) => {
      const child = spawn(
        process.execPath,
        [resolve("scripts/sidecut-cli.mjs"), ...args, "--endpoint-file", discovery],
        {
          cwd: root,
          env: {
            ...process.env,
            ELECTRON_RUN_AS_NODE: "1",
            SIDECUT_PROJECT: "",
            TANDEM_PROJECT: "",
          },
          windowsHide: true,
        },
      );
      let out = "",
        err = "";
      child.stdout.on("data", (v) => (out += v));
      child.stderr.on("data", (v) => (err += v));
      child.on("error", reject);
      child.on("close", (code) => done({ code, out, err }));
    });
  const before = host.snapshot().json,
    preview = await cli("join");
  expect(preview.code, preview.err).toBe(0);
  expect(preview.out).toContain("dry run");
  expect(host.snapshot().json).toBe(before);
  const applied = await cli(
    "join",
    "--apply",
    "--expect",
    "1",
    "--label",
    "Join fixture",
    "--json",
  );
  expect(applied.code, applied.err).toBe(0);
  expect(JSON.parse(applied.out).applied).toMatchObject({
    revision: 2,
    label: "Join fixture",
    author: "cli",
  });
  expect((await cli("join", "--apply", "--expect", "1")).code).toBe(4);
  await api.handle("undo", {});
  expect(JSON.parse(host.snapshot().json).project.audioTracks[0].clips).toHaveLength(2);
  const source = host.snapshot().json,
    revision = JSON.parse(source).revision;
  const copyPreview = await cli("short", "--copy", "-o", "fixture", "--json");
  expect(copyPreview.code, copyPreview.err).toBe(0);
  expect(JSON.parse(copyPreview.out).copy).toBeUndefined();
  expect(JSON.parse(copyPreview.out).commands.at(-1)).toHaveProperty("adoptFormat");
  await expect(stat(join(root, "exports", "fixture.tandem"))).rejects.toThrow();
  const copied = await cli("short", "--copy", "-o", "fixture", "--apply", "--json");
  expect(copied.code, copied.err).toBe(0);
  const saved = JSON.parse(await readFile(JSON.parse(copied.out).copy, "utf8"));
  expect(saved.project.settings).toMatchObject({ width: 1080, height: 1920 });
  expect(saved.project.name).toBe("fixture");
  expect(saved.project.id).not.toBe(initial.project.id);
  expect(saved.revision).toBe(revision);
  expect(saved).not.toHaveProperty("sidecutJournal");
  expect(host.snapshot().json).toBe(source);
  expect((await cli("short", "--copy", "-o", "fixture", "--apply")).code).not.toBe(0);
  expect(host.snapshot().json).toBe(source);
  const changing = new ProjectAPI(host, undefined, {
    ready: () => true,
    run: async () => {
      await api.handle("apply", {
        commands: [{ updateProject: { patch: { name: "Concurrent edit" } } }],
      });
      return { resources: 0 };
    },
    screenshot: async () => new Uint8Array(),
  });
  await expect(
    changing.handle("short", { copy: true, copyPath: "stale-copy.tandem", apply: true }),
  ).rejects.toThrow("changed while preparing");
  await expect(stat(join(root, "exports", "stale-copy.tandem"))).rejects.toThrow();
  const beforeCards = host.snapshot().json;
  const unavailable = await cli("cards", "--no-sounds");
  expect(unavailable.code).toBe(3);
  expect(unavailable.err).toContain("attached editor");
  expect(host.snapshot().json).toBe(beforeCards);
});
