import { afterEach, expect, it, vi } from "vite-plus/test";
import { mkdtemp, readFile, writeFile, rm, mkdir, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { NativeProjectStore } from "./project-store.ts";
import { HostProjectService } from "./project-service.ts";
import { ProjectAPI } from "./project-api.ts";
import { LocalHTTPService } from "./http-service.ts";
import { decodeProjectFile } from "@sidecut/contracts/project";
import { replayJournal } from "@sidecut/core/coordinator";

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of cleanup.reverse().splice(0)) await close();
});
function cli(...args: string[]) {
  return node([resolve("scripts/sidecut-cli.mjs"), ...args]);
}
function node(args: string[], env: NodeJS.ProcessEnv = {}) {
  return new Promise<{ code: number | null; out: string; err: string }>((resolveResult, reject) => {
    const processChild = spawn(process.execPath, args, {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", ...env },
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
  expect(readable.out).toContain("Landscape.tandem");
  expect(JSON.parse(host.snapshot().json).project.name).toBe("Landscape");
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
  expect(JSON.parse(filmora.out)).toMatchObject({
    name: "Filmora CLI fixture",
    report: {
      format: "filmora",
      clips: expect.any(Number),
      media: expect.any(Number),
      warnings: expect.any(Array),
    },
  });
  expect(JSON.parse(await readFile(join(root, "filmora-result.tandem"), "utf8")).project.name).toBe(
    "Filmora CLI fixture",
  );
  expect(replayJournal(decodeProjectFile(JSON.parse(host.snapshot().json))).project.name).toBe(
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
  expect(JSON.parse(host.snapshot().json).project.name).toBe("folder");
  await writeFile(
    join(root, "wrapper.json"),
    JSON.stringify({
      edl: { segments: [{ start: 0, end: 1, layout: "cam" }] },
      recipe: { name: "Legacy EDL", takes: [{ start: 0, camera: "camera.mov" }] },
    }),
  );
  const wrapper = await run(
    "project",
    "import-edl",
    "--path=wrapper.json",
    `--expect=${JSON.parse(host.snapshot().json).revision}`,
  );
  expect(wrapper.code, wrapper.err).toBe(0);
  expect(JSON.parse(wrapper.out)).toMatchObject({
    name: "Legacy EDL",
    report: { format: "edl", clips: 2, media: 1, warnings: [] },
  });
});

// Multiple CLI subprocesses need headroom on shared CI runners.
it("rejects valued native switches before replacement and accepts command and flag aliases", async () => {
  const { run, host } = await setup();
  const before = host.snapshot().json;
  for (const args of [
    ["new", "Bad", "--portrait=false"],
    ["app", "--json=false"],
    ["import-filmora", "source.wfp", "--keep-levels=invalid"],
    ["new", "Bad", "--expect", "0", "--expected-revision", "0"],
    ["new", "Bad", "--path", "other"],
    ["new", "Bad", "--size"],
    ["new", "Bad", "--size", "1x2x3"],
    ["new", "Bad", "--size=1x2", "--size=3x4"],
    ["app", "--typo"],
  ]) {
    const result = await run(...args);
    expect(result.code, JSON.stringify({ args, ...result })).toBe(2);
    expect(result.out).toBe("");
    expect(host.snapshot().json).toBe(before);
  }
  const result = await run(
    "project",
    "new",
    "Custom.tandem",
    "--portrait",
    "--size=640X480",
    "--expect=0",
    "--json",
  );
  expect(result.code, result.err).toBe(0);
  expect(JSON.parse(result.out)).toMatchObject({ name: "Custom", width: 640, height: 480 });
  for (const flag of ["search", "rewrite"]) {
    expect((await run("import", "filmora", "source.wfp", `--${flag}=unsupported`)).code).toBe(6);
  }
}, 30_000);

it("cleans an exclusive import output when replacement fails and preserves existing output", async () => {
  const { run, root, host } = await setup();
  await copyFile(resolve("tests/fixtures/tandem/filmora-basic.wfp"), join(root, "filmora.wfp"));
  const before = host.snapshot().json;
  const replace = vi.spyOn(host, "replace").mockRejectedValueOnce(new Error("Replacement failed"));
  try {
    const failed = await run("import-filmora", "filmora.wfp", "--out", "failed", "--json");
    expect(failed.code, failed.err).toBe(2);
    expect(replace).toHaveBeenCalledOnce();
    await expect(readFile(join(root, "failed.tandem"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(host.snapshot().json).toBe(before);
  } finally {
    replace.mockRestore();
  }
  await writeFile(join(root, "existing.tandem"), "keep me");
  expect((await run("import-filmora", "filmora.wfp", "--out", "existing", "--json")).code).toBe(2);
  expect(await readFile(join(root, "existing.tandem"), "utf8")).toBe("keep me");
  expect(host.snapshot().json).toBe(before);
  expect(
    (await run("import-filmora", "filmora.wfp", "--expect=999", "--out=stale", "--json")).code,
  ).toBe(4);
  await expect(readFile(join(root, "stale.tandem"))).rejects.toMatchObject({ code: "ENOENT" });
});

it("launches only after absent discovery, detaches immediately and classifies spawn failures", async () => {
  const root = await mkdtemp(join(tmpdir(), "sidecut-launch-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const endpoint = join(root, "absent.json");
  // Stub only process creation: discovery, executable validation and CLI error handling are real.
  const script = `
    import childProcess from 'node:child_process';
    import { syncBuiltinESMExports } from 'node:module';
    import { EventEmitter } from 'node:events';
    import assert from 'node:assert/strict';
    childProcess.spawn = (executable, args, options) => {
      assert.equal(executable, process.execPath);
      assert.deepEqual(args, []);
      assert.equal(options.env.ELECTRON_RUN_AS_NODE, undefined);
      assert.equal(options.env.SIDECUT_APP_EXECUTABLE, process.execPath);
      assert.equal(options.detached, true);
      assert.equal(options.windowsHide, true);
      assert.equal(options.stdio, 'ignore');
      const child = new EventEmitter();
      child.unref = () => { process.stdout.write('unref\\n'); };
      if (process.env.LAUNCH_MODE === 'throw') throw new Error('synchronous spawn failure');
      queueMicrotask(() => process.env.LAUNCH_MODE === 'error'
        ? child.emit('error', new Error('asynchronous spawn failure')) : child.emit('spawn'));
      return child;
    };
    syncBuiltinESMExports();
    process.argv = [process.execPath, 'cli', 'app', '--json', '--endpoint-file', process.env.TEST_ENDPOINT];
    await import('./scripts/sidecut-cli.mjs');
  `;
  const launch = (mode: string, executable = process.execPath) =>
    node(["--input-type=module", "--eval", script], {
      TEST_ENDPOINT: endpoint,
      SIDECUT_APP_EXECUTABLE: executable,
      LAUNCH_MODE: mode,
    });
  const launched = await launch("success");
  expect(launched.code, launched.err).toBe(0);
  expect(launched.out).toBe('unref\n{"opened":true,"launched":true}\n');
  for (const mode of ["throw", "error"]) {
    const failed = await launch(mode);
    expect(failed.code, failed.err).toBe(3);
    expect(failed.out).toBe("");
    expect(failed.err).toContain("spawn failure");
  }
  for (const executable of ["relative.exe", root, join(root, "missing.exe")]) {
    const invalid = await launch("success", executable);
    expect(invalid.code, invalid.err).toBe(3);
    expect(invalid.out).toBe("");
  }
  await writeFile(endpoint, "not JSON");
  const malformed = await launch("success");
  expect(malformed.code).toBe(2);
  expect(malformed.out).toBe("");
  await writeFile(endpoint, JSON.stringify({ port: 0, token: "invalid" }));
  const invalid = await launch("success");
  expect(invalid.code).toBe(2);
  expect(invalid.out).toBe("");
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
  const schema = await run("schema", "--service", "--json");
  expect(schema.code, schema.err).toBe(0);
  expect(JSON.parse(schema.out)).toHaveProperty("operations.import-filmora");
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
