import { afterEach, expect, it } from "vite-plus/test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { parseArguments } from "../../../../scripts/cli-foundation.mjs";
import { prepareLibraryCommand, libraryText } from "../../../../scripts/cli-library-commands.mjs";
import contract from "../../../../tests/fixtures/tandem/cli-library.json";
import { HostProjectService } from "./project-service.ts";
import { NativeProjectStore } from "./project-store.ts";
import { ProjectAPI } from "./project-api.ts";
import { LocalHTTPService } from "./http-service.ts";
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of cleanup.reverse().splice(0)) await close();
});
it("matches pinned readable asset operations", () => {
  for (const e of contract.examples) expect(libraryText(e.operation, e.result)).toBe(e.text);
});
it("maps native assets and segment selectors and preserves paid confirmation", () => {
  expect(
    prepareLibraryCommand(parseArguments(["assets", "search", "soft", "whoosh"]))?.flags.get(
      "text",
    ),
  ).toBe("soft whoosh");
  expect(
    prepareLibraryCommand(parseArguments(["assets", "fetch", "import:picture"]))?.flags.get("id"),
  ).toBe("import:picture");
  expect(
    prepareLibraryCommand(parseArguments(["assets", "credits", "--optional"]))?.flags.get(
      "include-optional",
    ),
  ).toBe(true);
  expect(
    prepareLibraryCommand(parseArguments(["assets", "generate", "sfx", "Soft whoosh"]))?.prepare({
      kind: "sfx",
      prompt: "Soft whoosh",
    }),
  ).toMatchObject({ confirmedPaid: false });
  expect(prepareLibraryCommand(parseArguments(["segments"]))?.words).toEqual(["segments", "list"]);
  expect(
    prepareLibraryCommand(parseArguments(["segments", "save", "Intro", "--clips", "a"]))?.flags.get(
      "name",
    ),
  ).toBe("Intro");
  expect(
    prepareLibraryCommand(parseArguments(["segments", "insert", "Intro", "--at", "1"]))?.prepare({
      name: "Intro",
      at: "1",
    }),
  ).toMatchObject({ name: "Intro", at: 1 });
  for (const args of [
    ["assets"],
    ["assets", "nope"],
    ["assets", "providers", "extra"],
    ["assets", "fetch"],
    ["assets", "generate", "sfx"],
    ["assets", "use", "id", "extra"],
    ["assets", "credits", "--optional", "--include-optional", "true"],
    ["segments", "save", "Intro"],
    ["segments", "save", "Intro", "--clips", "a", "--from", "0"],
    ["segments", "insert", "Intro"],
  ])
    expect(() => prepareLibraryCommand(parseArguments(args))).toThrow();
});
it("validates native library syntax before dispatch and reports unavailable owners without edits", async () => {
  const root = await mkdtemp(join(tmpdir(), "sidecut-cli-library-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const host = new HostProjectService(new NativeProjectStore(join(root, "current.tandem")));
  await host.start();
  cleanup.push(() => host.close());
  const server = new LocalHTTPService(new ProjectAPI(host)),
    endpoint = await server.start();
  cleanup.push(() => server.close());
  const discovery = join(root, "endpoint.json");
  await writeFile(discovery, JSON.stringify(endpoint));
  const before = host.snapshot().json;
  const run = (args: string[]) =>
    new Promise<{ code: number | null; err: string }>((done, reject) => {
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
      let err = "";
      child.stdout.resume();
      child.stderr.on("data", (v) => (err += v));
      child.on("error", reject);
      child.on("close", (code) => done({ code, err }));
    });
  for (const args of [
    ["assets", "providers"],
    ["assets", "search", "picture"],
    ["assets", "fetch", "import:picture"],
    ["assets", "show", "import:picture"],
    ["assets", "use", "import:picture"],
    ["assets", "credits"],
    ["assets", "install-starter"],
    ["segments", "list"],
    ["segments", "save", "Intro", "--clips", "a"],
    ["segments", "insert", "Intro", "--at", "0"],
  ]) {
    const result = await run(args);
    expect(result.code, result.err).toBe(3);
    expect(host.snapshot().json).toBe(before);
  }
  for (const args of [
    ["assets", "generate", "image", "Nope"],
    ["segments", "save", "Intro"],
    ["segments", "insert", "Intro", "--at", "bad"],
  ])
    expect((await run(args)).code).toBe(2);
}, 20000);
