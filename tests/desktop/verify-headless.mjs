// Run with Node after vp run build:desktop; no dev server or visible window is needed.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm, cp } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { acquireProjectHost } from "../../scripts/headless-host.mjs";
import { hostCall, watchHost } from "../../scripts/host-client.mjs";

const root = await mkdtemp(join(tmpdir(), "sidecut-headless-acceptance-"));
let owner, other, reopened, library;
const results = { platform: process.platform, production: true };
try {
  process.env.APPDATA = join(root, "appdata");
  process.env.XDG_CONFIG_HOME = join(root, "config");
  delete process.env.SIDECUT_API_FILE;
  delete process.env.SIDECUT_PROJECT;
  delete process.env.TANDEM_PROJECT;
  delete process.env.SIDECUT_RENDERER_URL;
  await mkdir(process.env.APPDATA, { recursive: true });
  const path = join(root, "Closed 项目.tandem");
  const json = JSON.stringify({
    revision: 0,
    project: {
      id: "headless_fixture",
      name: "Closed fixture",
      settings: { width: 320, height: 180 },
      videoTracks: [
        {
          id: "v",
          kind: "video",
          clips: [
            {
              id: "solid",
              duration: 1,
              content: { solid: { color: { r: 0.3, g: 0.6, b: 0.2, a: 1 } } },
            },
          ],
        },
      ],
    },
  });
  await writeFile(path, json);
  const flags = new Map([["project", path]]);
  owner = await acquireProjectHost(flags, { signal: AbortSignal.timeout(60000) });
  assert.equal(
    await readFile(path, "utf8"),
    json,
    "read-only startup must not rewrite the portable file",
  );
  const initial = await hostCall(owner.endpoint, "status");
  assert.equal(initial.revision, 0);
  other = await acquireProjectHost(flags);
  assert.equal(other.endpoint.pid, owner.endpoint.pid, "one authoritative process");
  const runner = join(root, "sidecut-run.mjs");
  await cp(new URL("../../scripts/sidecut-run.mjs", import.meta.url), runner);
  await cp(new URL("../../packages/client/dist", import.meta.url), join(root, "sdk"), {
    recursive: true,
  });
  const run = async (args, stdin = "") =>
    new Promise((done, reject) => {
      const child = spawn(process.execPath, [runner, path, ...args], {
        env: process.env,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
      let out = "",
        err = "";
      child.stdout.on("data", (data) => {
        out += data;
      });
      child.stderr.on("data", (data) => {
        err += data;
      });
      child.once("error", reject);
      child.once("exit", (code) => {
        if (code !== 0) reject(new Error(`Script runner failed (${code}): ${err}`));
        else done(out.trim());
      });
      child.stdin.end(stdin);
    });
  const script = join(root, "script.ts");
  await writeFile(
    script,
    "export default async (t: { status: () => Promise<{ revision: number }> }) => (await t.status()).revision;",
  );
  assert.equal(await run([script]), "0");
  assert.equal(
    await run([
      "-e",
      "return {revision: (await t.status()).revision, helpers: typeof cmd.updateProject === 'function' && typeof fixCaptionWords === 'function'}",
    ]),
    '{"revision":0,"helpers":true}',
  );
  assert.equal(await run(["-"], "return (await t.status()).revision;"), "0");
  results.standaloneSdkRunner = { typescriptFile: true, inline: true, stdin: true };
  const edit = await hostCall(other.endpoint, "apply", {
    expectedRevision: 0,
    label: "Headless edit",
    commands: [{ updateProject: { patch: { name: "Edited without opening a window" } } }],
  });
  assert.equal(edit.revision, 1);
  await owner.close();
  assert.equal(
    (await hostCall(other.endpoint, "status")).revision,
    1,
    "closing one lease keeps the other client alive",
  );
  const frame = await hostCall(other.endpoint, "frame", { time: 0, maxWidth: 320 });
  const png = Buffer.from(frame.png, "base64");
  assert.equal(png.readUInt32BE(16), 320);
  const streamAbort = new AbortController();
  const stream = watchHost(other.endpoint, { signal: streamAbort.signal });
  await stream.next();
  const events = [];
  const observe = (async () => {
    for await (const event of stream) {
      events.push(event);
      if (event.kind === "export" && event.export.state === "done") return;
    }
  })();
  const exported = await hostCall(
    other.endpoint,
    "export",
    { preset: "webm", output: "headless.webm" },
    AbortSignal.timeout(30000),
  );
  await observe;
  streamAbort.abort();
  assert.ok((await readFile(exported.path)).length > 100);
  assert.ok(
    events.some(
      (event) => event.kind === "export" && event.export.progress > 0 && event.export.progress < 1,
    ),
  );
  await other.close();
  reopened = await acquireProjectHost(flags);
  assert.equal((await hostCall(reopened.endpoint, "status")).revision, 1);
  await hostCall(reopened.endpoint, "undo", { expectedRevision: 1 });
  assert.equal(JSON.parse(await readFile(path, "utf8")).project.name, "Closed fixture");
  results.sharedOwner = true;
  results.portableEditUndoReopen = true;
  results.frame = { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
  results.export = { bytes: exported.bytes, progressEvents: events.length };
  library = await acquireProjectHost(new Map(), { library: true });
  const providers = await hostCall(library.endpoint, "assets-providers", {});
  results.standaloneLibrary = { available: Boolean(providers) };
  await library.close();
  await writeFile(
    new URL("../../docs/verification/headless-runtime.json", import.meta.url),
    JSON.stringify(results, null, 2) + "\n",
  );
  process.stdout.write(JSON.stringify(results) + "\n");
} finally {
  await library?.close();
  await reopened?.close();
  await other?.close();
  await owner?.close();
  await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}
