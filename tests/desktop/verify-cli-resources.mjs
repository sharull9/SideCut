// Repository Electron acceptance workflow: build:desktop and dev server :4270.
import { app, BrowserWindow } from "electron";
import { mkdtempSync } from "node:fs";
import { writeFile, mkdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";

const root = resolve(import.meta.dirname, "../.."),
  profile = mkdtempSync(join(tmpdir(), "sidecut-cli-resources-"));
app.setPath("userData", profile);
app.setAppPath(join(root, "apps/desktop"));
process.env.SIDECUT_RENDERER_URL = "http://127.0.0.1:4270";
let exitCode = 0;
async function wait(predicate) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error("Runtime timed out");
}
async function verify() {
  try {
    await import("../../apps/desktop/dist/main.mjs");
    await app.whenReady();
    let window;
    await wait(() => {
      window = BrowserWindow.getAllWindows()[0];
      return !!window;
    });
    const evaluate = (code) => window.webContents.executeJavaScript(`(async()=>(${code}))()`, true);
    await wait(() =>
      evaluate("Boolean(document.querySelector('.editor-workspace'))").catch(() => false),
    );
    await evaluate(
      `(async()=>{const {BrowserProjectSession}=await import('/src/modules/workspace/browser-session.ts');window.fixtureSession=new BrowserProjectSession();await fixtureSession.start();})()`,
    );
    const run = (args, stdin = "") =>
      new Promise((done, reject) => {
        const child = spawn(
          process.execPath,
          [
            join(root, "scripts/sidecut-cli.mjs"),
            ...args,
            "--endpoint-file",
            join(profile, "current.tandem.api.json"),
          ],
          {
            cwd: profile,
            env: {
              ...process.env,
              ELECTRON_RUN_AS_NODE: "1",
              SIDECUT_PROJECT: "",
              TANDEM_PROJECT: "",
              SIDECUT_AUTHOR: "runtime-cli",
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
        child.stdin.end(stdin);
      });
    const success = async (args, stdin) => {
      const result = await run(args, stdin);
      assert.equal(result.code, 0, result.err);
      return result.out;
    };
    const json = async (...args) => JSON.parse(await success([...args, "--json"]));
    const revision = async () => Number(await success(["status", "--revision"])),
      project = () => evaluate("JSON.stringify(fixtureSession.projectFile().project)");
    const effects = await json("effects");
    assert.equal(effects.effects.length, 15);
    assert.match(await success(["effects", "BLUR"]), /blur  video/);
    assert.equal((await run(["effects", "missing"])).code, 5);
    assert.match(
      await success(["watch", "--once", "--timeout", "0"]),
      /No change. Still at revision 0/,
    );
    const watched = spawn(
      process.execPath,
      [
        join(root, "scripts/sidecut-cli.mjs"),
        "watch",
        "--json",
        "--timeout",
        "0.2",
        "--endpoint-file",
        join(profile, "current.tandem.api.json"),
      ],
      {
        cwd: profile,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", SIDECUT_PROJECT: "", TANDEM_PROJECT: "" },
        windowsHide: true,
      },
    );
    let events = "";
    watched.stdout.on("data", (v) => (events += v));
    watched.stderr.resume();
    const closed = new Promise((done, reject) => {
      watched.on("close", done);
      watched.on("error", reject);
    });
    try {
      await new Promise((done) => setTimeout(done, 300));
      await json(
        "apply",
        JSON.stringify({
          commands: [
            { updateSettings: { patch: { width: 320, height: 180 } } },
            { addTrack: { id: "picture", kind: "video", name: "CLI picture" } },
            {
              insertClip: {
                trackID: "picture",
                clip: {
                  id: "solid",
                  duration: 2,
                  content: { solid: { color: { r: 0.8, g: 0.2, b: 0.1, a: 1 } } },
                },
              },
            },
            { addTrack: { id: "voice-track", kind: "audio", name: "CLI Voice" } },
            {
              addMedia: {
                item: {
                  id: "voice",
                  path: "missing.wav",
                  kind: "audio",
                  hasAudio: true,
                  duration: 2,
                },
              },
            },
            {
              insertClip: {
                trackID: "voice-track",
                clip: { id: "voice-clip", duration: 2, content: { media: { mediaID: "voice" } } },
              },
            },
          ],
        }),
        "--label",
        "Watched fixture",
      );
      await wait(() => events.includes("Watched fixture"));
    } finally {
      watched.kill();
      await closed;
    }
    const watchEvent = JSON.parse(events.trim().split("\n")[0]);
    assert.equal(watchEvent.revision, 1);
    const beforeRelink = await project(),
      sources = join(profile, "sources");
    await mkdir(sources);
    const wav = Buffer.alloc(44 + 32000);
    wav.write("RIFF");
    wav.writeUInt32LE(wav.length - 8, 4);
    wav.write("WAVEfmt ", 8);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(8000, 24);
    wav.writeUInt32LE(16000, 28);
    wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34);
    wav.write("data", 36);
    wav.writeUInt32LE(32000, 40);
    for (let i = 0; i < 16000; i++)
      wav.writeInt16LE(Math.round(6000 * Math.sin((2 * Math.PI * 440 * i) / 8000)), 44 + i * 2);
    await writeFile(join(sources, "missing.wav"), wav);
    const preview = await json("relink", "--search", sources, "--dry-run");
    assert.equal(preview.relinked.length, 1);
    assert.equal(preview.relinked[0].mediaID, "voice");
    assert.equal(await project(), beforeRelink);
    assert.equal(await revision(), 1);
    assert.match(
      await success(["relink", "--search", sources, "--dry-run"]),
      /Would relink 1 of 1/,
    );
    const relinked = await json(
      "relink",
      "--search",
      sources,
      "--label",
      "CLI relink",
      "--expect",
      "1",
    );
    assert.equal(relinked.applied.revision, 2);
    assert.equal(relinked.applied.author, "runtime-cli");
    await wait(() =>
      evaluate(
        "fixtureSession.getSnapshot().project.media.find(m=>m.id==='voice').path.includes('sources')",
      ),
    );
    assert.equal((await run(["relink", "--search", sources, "--expect", "1"])).code, 4);
    await json("undo");
    assert.equal(await project(), beforeRelink);
    assert.equal(await revision(), 3);
    const copyRoot = join(profile, "..", `archive-copy-${Date.now()}`),
      archivePreview = await json("archive", "--to", copyRoot, "--dry-run", "--with-cache");
    assert.equal(archivePreview.mode, "archive");
    assert.equal(archivePreview.dryRun, true);
    await assert.rejects(stat(archivePreview.folder));
    assert.equal(await project(), beforeRelink);
    const archived = await json("archive", "--to", copyRoot, "--with-cache");
    assert.equal(archived.mode, "archive");
    assert.ok((await stat(archived.openFile)).size > 0);
    assert.ok((await stat(archived.manifest)).size > 0);
    assert.equal(await project(), beforeRelink);
    assert.notEqual((await run(["archive", "--to", copyRoot])).code, 0);
    const consolidatedPreview = await json("archive", "--dry-run");
    assert.equal(consolidatedPreview.mode, "consolidate");
    const consolidated = await json("archive", "--label", "CLI consolidate");
    assert.equal(consolidated.mode, "consolidate");
    assert.equal(await revision(), 4);
    await json("undo");
    assert.equal(await project(), beforeRelink);
    assert.equal(await revision(), 5);
    const beforeCheck = await project(),
      quick = await json("check", "--quick", "--from", "0", "--to", "1");
    assert.equal(quick.ok, true);
    assert.match(
      await success(["check", "--quick", "--from", "0", "--to", "1"]),
      /quick: no frames rendered/,
    );
    assert.equal(await project(), beforeCheck);
    const scanned = await json("check", "--from", "0", "--to", "0.2", "--width", "96");
    assert.ok(scanned.frames > 0);
    const failures = [];
    for (const args of [
      ["watch", "--once", "--timeout", "NaN"],
      ["archive", "--with-cache"],
      ["relink", "--search", join(profile, "not-there"), "--dry-run"],
      ["check", "--quick", "--cuts"],
      ["check", "--width", "1"],
    ]) {
      const result = await run(args);
      assert.notEqual(result.code, 0, JSON.stringify(args));
      failures.push({ args, code: result.code });
      assert.equal(await project(), beforeCheck);
    }
    await json("apply", JSON.stringify({ commands: [{ removeClips: { clipIDs: ["solid"] } }] }));
    const problem = await run(["check", "--quick", "--json"]);
    assert.equal(problem.code, 1);
    assert.equal(JSON.parse(problem.out).ok, false);
    await json("undo");
    assert.equal(await project(), beforeCheck);
    const evidence = {
      platform: process.platform,
      reference: "735a9b8e162c1f951044baa892d94993869f2e77",
      watch: { event: watchEvent, cancelled: true },
      effects: { count: effects.effects.length, offline: true },
      relink: { preview: preview.relinked, applied: relinked.applied, undo: true },
      archive: {
        previewWritesNothing: true,
        copy: archived.folder,
        collected: archived.collected.length,
        consolidationUndo: true,
      },
      check: { quick: quick.ok, frames: scanned.frames, problemExit: problem.code, readOnly: true },
      failures,
      finalRevision: await revision(),
      limits: [
        "Watch uses revision long polling rather than native SSE job/export events",
        "Folder archive collects managed project resources only",
        "Windows development runtime; native platforms unverified",
      ],
    };
    await writeFile(
      join(root, "docs/verification/cli-resources-runtime.json"),
      JSON.stringify(evidence, null, 2) + "\n",
    );
    console.log(JSON.stringify(evidence));
  } catch (error) {
    exitCode = 1;
    console.error(error);
  } finally {
    app.once("will-quit", () => app.exit(exitCode));
    app.quit();
  }
}
void verify();
