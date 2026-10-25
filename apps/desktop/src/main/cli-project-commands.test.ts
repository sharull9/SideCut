import { afterEach, expect, it } from "vite-plus/test";
import { mkdtemp, readFile, writeFile, rm, mkdir, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { NativeProjectStore } from "./project-store.ts";
import { HostProjectService } from "./project-service.ts";
import { ProjectAPI } from "./project-api.ts";
import { LocalHTTPService } from "./http-service.ts";

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of cleanup.reverse().splice(0)) await close();
});
function cli(...args: string[]) {
  return new Promise<{ code: number | null; out: string; err: string }>((resolveResult, reject) => {
    const processChild = spawn(process.execPath, [resolve("scripts/sidecut-cli.mjs"), ...args], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      windowsHide: true,
    });
    let out = "",
      err = "";
    processChild.stdout.on("data", (chunk) => (out += chunk));
    processChild.stderr.on("data", (chunk) => (err += chunk));
    processChild.once("error", reject);
    processChild.once("close", (code) => resolveResult({ code, out, err }));
  });
}
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "sidecut-cli-project-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const host = new HostProjectService(new NativeProjectStore(join(root, "current.tandem")));
  await host.start();
  cleanup.push(() => host.close());
  let activations = 0;
  const api = new ProjectAPI(host, undefined, {
    ready: () => false,
    activate: () => {
      activations++;
    },
    screenshot: async () => new Uint8Array(),
    run: async () => {
      throw new Error("Unused");
    },
  });
  const server = new LocalHTTPService(api),
    address = await server.start();
  cleanup.push(() => server.close());
  const endpoint = join(root, "endpoint.json");
  await writeFile(endpoint, JSON.stringify(address));
  return {
    root,
    host,
    api,
    activations: () => activations,
    run: (...args: string[]) => cli(...args, "--endpoint-file", endpoint),
  };
}

it("creates native positional projects with settings, safe output, guards and readable output", async () => {
  const { run, host, root } = await setup();
  const created = await run(
    "new",
    "Portrait",
    "--portrait",
    "--name",
    "Portrait fixture",
    "--json",
  );
  expect(created.code, created.err).toBe(0);
  expect(JSON.parse(created.out)).toMatchObject({
    name: "Portrait fixture",
    width: 1080,
    height: 1920,
    tracks: ["Screen", "Camera", "B-roll", "Graphics", "Text", "Voice", "Music", "SFX"],
  });
  expect(
    JSON.parse(await readFile(join(root, "Portrait.tandem"), "utf8")).project.settings.width,
  ).toBe(1080);
  const before = host.snapshot().json;
  expect((await run("new", "Portrait", "--json")).code).toBe(2);
  expect(host.snapshot().json).toBe(before);
  expect((await run("new", "../escape", "--json")).code).toBe(2);
  expect((await run("new", "Guarded", "--expect", "999", "--json")).code).toBe(4);
  expect(host.snapshot().json).toBe(before);
  const readable = await run("new", "Landscape");
  expect(readable.code, readable.err).toBe(0);
  expect(readable.out).toContain("3840x2160");
  expect((await run("new", "Bad", "--size", "0x10")).code).toBe(2);
});

it("imports separate EDL/recipe and Filmora positional sources through the host", async () => {
  const { run, root, host, api } = await setup();
  await writeFile(
    join(root, "recipe.json"),
    JSON.stringify({ name: "EDL fixture", takes: [{ start: 0, camera: "camera.mov" }] }),
  );
  await writeFile(
    join(root, "edl.json"),
    JSON.stringify({ segments: [{ start: 0, end: 1, layout: "cam" }] }),
  );
  const edl = await run(
    "import",
    "edl",
    "edl.json",
    "--recipe",
    "recipe.json",
    "--out",
    "edl-result",
    "--json",
  );
  expect(edl.code, edl.err).toBe(0);
  expect(JSON.parse(edl.out)).toMatchObject({ name: "EDL fixture", report: { clips: 2 } });
  expect(
    JSON.parse(host.snapshot().json).project.videoTracks.some(
      (t: { clips: unknown[] }) => t.clips.length > 0,
    ),
  ).toBe(true);
  await copyFile(resolve("tests/fixtures/tandem/filmora-basic.wfp"), join(root, "filmora.wfp"));
  const filmora = await run(
    "import",
    "filmora",
    "filmora.wfp",
    "--name",
    "Filmora CLI fixture",
    "--keep-levels",
    "--out",
    "filmora-result",
    "--json",
  );
  expect(filmora.code, filmora.err).toBe(0);
  expect(JSON.parse(filmora.out)).toMatchObject({ name: "Filmora CLI fixture" });
  expect(JSON.parse(await readFile(join(root, "filmora-result.tandem"), "utf8")).project.name).toBe(
    "Filmora CLI fixture",
  );
  const before = host.snapshot().json;
  expect((await run("import", "edl", "edl.json")).code).toBe(2);
  await writeFile(join(root, "invalid.json"), "not JSON");
  expect(
    (await run("import", "edl", "invalid.json", "--recipe", "recipe.json", "--json")).code,
  ).toBe(2);
  expect(host.snapshot().json).toBe(before);
  await expect(
    api.handle("import-filmora", { path: "../outside.wfp", expectedRevision: 0 }),
  ).rejects.toThrow();
  expect(host.snapshot().json).toBe(before);
  await mkdir(join(root, "folder"));
  expect((await run("new", "folder", "--json")).code).toBe(0);
  expect(JSON.parse(await readFile(join(root, "folder/folder.tandem"), "utf8")).revision).toBe(0);
});

it("activates the application without changing the project, with explicit unsupported targets", async () => {
  const { run, host, activations } = await setup(),
    before = host.snapshot().json;
  const result = await run("app");
  expect(result.code, result.err).toBe(0);
  expect(result.out).toContain("Opened SideCut");
  expect(activations()).toBe(1);
  expect(host.snapshot().json).toBe(before);
  expect((await run("app", "another.tandem")).code).toBe(6);
});

it("prints an authoritative offline edit schema without discovery credentials", async () => {
  const result = await cli("schema", "--json");
  expect(result.code, result.err).toBe(0);
  const schema = JSON.parse(result.out);
  expect(JSON.stringify(schema)).toContain("updateClip");
  expect(schema).toHaveProperty("properties.commands.items");
  expect(schema).toHaveProperty("$schema", "https://json-schema.org/draft/2020-12/schema");
  expect((await cli("schema", "--typo")).code).toBe(2);
});
