import { afterEach, expect, it, vi } from "vite-plus/test";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { effectsCatalog } from "@sidecut/core/effects";
import { parseArguments } from "../../../../scripts/cli-foundation.mjs";
import {
  prepareResourceCommand,
  resourceText,
} from "../../../../scripts/cli-resource-commands.mjs";
import contract from "../../../../tests/fixtures/tandem/cli-resources.json";
import { HostProjectService } from "./project-service.ts";
import { NativeProjectStore } from "./project-store.ts";
import { ProjectAPI } from "./project-api.ts";
import { LocalHTTPService } from "./http-service.ts";
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of cleanup.reverse().splice(0)) await close();
});
it("ships the authoritative offline effects catalogue", async () => {
  const path = resolve("scripts/effects-catalog.json"),
    catalogue = effectsCatalog();
  if (process.env.SIDECUT_UPDATE_EFFECTS_CATALOG === "1")
    await writeFile(path, JSON.stringify(catalogue, null, 2) + "\n");
  expect(JSON.parse(await readFile(path, "utf8"))).toEqual(catalogue);
});
it("matches pinned resource text and native option mappings", async () => {
  for (const example of contract.examples)
    expect(resourceText(example.operation, example.result)).toBe(example.text);
  expect(prepareResourceCommand(parseArguments(["watch"]))?.flags.get("follow")).toBe(true);
  expect(prepareResourceCommand(parseArguments(["watch", "--once"]))?.flags.has("follow")).toBe(
    false,
  );
  expect(
    prepareResourceCommand(
      parseArguments(["archive", "project.tandem", "--to", "copy"]),
    )?.flags.get("project"),
  ).toBe("project.tandem");
  const filtered = await prepareResourceCommand(parseArguments(["effects", "BLUR"]))?.offline?.();
  expect(filtered?.effects).toEqual(effectsCatalog("blur").effects);
  expect(
    prepareResourceCommand(
      parseArguments(["relink", "--media-id", "tone", "--path", "tone.wav"]),
    )?.prepare({ mediaID: "tone", path: "tone.wav" }),
  ).toEqual({ mediaID: "tone", path: "tone.wav" });
  for (const args of [
    ["watch", "extra"],
    ["watch", "--once", "--follow"],
    ["effects", "a", "b"],
    ["effects", "blur", "--type", "blur"],
    ["archive", "--with-cache"],
    ["relink", "extra"],
    ["check", "--quick", "--cuts"],
  ])
    expect(() => prepareResourceCommand(parseArguments(args))).toThrow();
});
it("runs offline effects and one-shot watch/check without changing the host", async () => {
  const root = await mkdtemp(join(tmpdir(), "sidecut-cli-resources-"));
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
  const run = (args: string[]) =>
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
  const before = host.snapshot().json;
  expect((await run(["effects", "blur"])).out).toContain("blur  video");
  expect((await run(["effects", "missing"])).code).toBe(5);
  const once = await run(["watch", "--once", "--timeout", "0"]);
  expect(once.code, once.err).toBe(0);
  expect(once.out).toBe("No change. Still at revision 0.\n");
  expect(host.snapshot().json).toBe(before);
  const initial = JSON.parse(before);
  await api.handle("apply", {
    commands: [
      {
        insertClip: {
          trackID: initial.project.audioTracks[0].id,
          clip: { id: "silence", duration: 1, content: { media: { mediaID: "tone" } } },
        },
      },
      {
        addMedia: {
          item: { id: "tone", kind: "audio", path: "tone.wav", duration: 1, hasAudio: true },
        },
      },
    ].reverse(),
  });
  const beforeCheck = host.snapshot().json,
    result = await run(["check", "--quick", "--json"]);
  expect(result.code).toBe(1);
  expect(JSON.parse(result.out).ok).toBe(false);
  expect(host.snapshot().json).toBe(beforeCheck);
  expect((await run(["archive", "--dry-run"])).code).toBe(3);
  expect((await run(["relink", "--search", root, "--dry-run"])).code).toBe(0);
}, 20000);
it("follows host revision events until the CLI is cancelled and releases the request", async () => {
  const root = await mkdtemp(join(tmpdir(), "sidecut-cli-follow-"));
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
  let watching = false;
  const handle = api.handle.bind(api);
  const observed = vi.spyOn(api, "handle").mockImplementation((operation, input, signal) => {
    const result = handle(operation, input, signal);
    if (operation === "watch") watching = true;
    return result;
  });
  cleanup.push(async () => {
    observed.mockRestore();
  });
  const child = spawn(
    process.execPath,
    [
      resolve("scripts/sidecut-cli.mjs"),
      "watch",
      "--json",
      "--timeout",
      "0.2",
      "--endpoint-file",
      discovery,
    ],
    {
      cwd: root,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", SIDECUT_PROJECT: "", TANDEM_PROJECT: "" },
      windowsHide: true,
    },
  );
  let out = "";
  child.stdout.on("data", (v) => (out += v));
  child.stderr.resume();
  const closed = new Promise<void>((done, reject) => {
    child.on("error", reject);
    child.on("close", () => done());
  });
  cleanup.push(async () => {
    if (child.exitCode == null) child.kill();
    await closed;
  });
  await vi.waitFor(() => expect(watching).toBe(true), { timeout: 5000 });
  await api.handle("apply", {
    label: "Watched",
    commands: [{ updateProject: { patch: { name: "Watched" } } }],
  });
  const deadline = Date.now() + 3000;
  while (!out.includes("Watched") && Date.now() < deadline)
    await new Promise((done) => setTimeout(done, 25));
  expect(out).toContain("Watched");
  expect(JSON.parse(out.trim().split("\n")[0]!)).toMatchObject({ revision: 1, label: "Watched" });
  child.kill();
  await closed;
  expect(await api.handle("watch", { timeout: 0 })).toMatchObject({ changed: false, revision: 1 });
}, 10000);
