// Repository Electron acceptance workflow: build:desktop and dev server :4270.
import { app, BrowserWindow } from "electron";
import { mkdtempSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";

const root = resolve(import.meta.dirname, "../.."),
  profile = mkdtempSync(join(tmpdir(), "sidecut-cli-history-review-"));
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
    const json = async (...args) => JSON.parse(await success([...args, "--json"])),
      revision = async () => Number(await success(["status", "--revision"])),
      project = () => evaluate("JSON.stringify(fixtureSession.projectFile().project)"),
      initial = await project(),
      initialRevision = await revision();
    assert.equal(initialRevision, 0);
    const emptyUndo = await run(["undo"]),
      emptyRedo = await run(["redo"]);
    assert.equal(emptyUndo.code, 2);
    assert.equal(emptyRedo.code, 2);
    const apply = (commands, label) =>
      json("apply", JSON.stringify({ commands }), "--label", label);
    await apply(
      [
        { addTrack: { id: "cli-track", name: "CLI review", kind: "video" } },
        {
          insertClip: {
            trackID: "cli-track",
            clip: {
              id: "cli-solid",
              duration: 3,
              content: { solid: { color: { r: 0.8, g: 0.2, b: 0.1, a: 1 } } },
            },
          },
        },
        { updateProject: { patch: { name: "First" } } },
      ],
      "First",
    );
    await apply([{ updateProject: { patch: { name: "Second" } } }], "Second");
    await wait(() => evaluate("fixtureSession.getSnapshot().project.name==='Second'"));
    const before = await project(),
      history = await json("history", "--limit", "1");
    assert.equal(history.revision, 2);
    assert.deepEqual(history.undo, [{ label: "Second", author: "runtime-cli" }]);
    assert.equal(history.edits.length, 1);
    assert.equal(history.edits[0].label, "Second");
    assert.match(await success(["history"]), /Undo, newest first:/);
    assert.equal(await project(), before);
    const failures = [];
    for (const args of [
      ["undo", "--expect", "0"],
      ["redo", "--expect", "0"],
      ["undo", "--count", "0"],
      ["redo", "--count", "501"],
      ["history", "--limit", "0"],
      ["validate", "--refresh"],
    ]) {
      const result = await run(args);
      assert.notEqual(result.code, 0, JSON.stringify(args));
      failures.push({ args, code: result.code });
      assert.equal(await project(), before);
      assert.equal(await revision(), 2);
    }
    const undone = await success(["project", "undo", "--count", "2", "--expect", "2"]);
    assert.match(undone, /Undid 2 edits: "Second" \(by runtime-cli\), "First" \(by runtime-cli\)/);
    await wait(async () => (await project()) === initial);
    assert.equal(await revision(), 4);
    const redone = await json("redo", "--count", "10", "--expect", "4");
    assert.equal(redone.count, 2);
    assert.deepEqual(redone.labels, ["First", "Second"]);
    assert.equal(redone.revision, 6);
    await wait(async () => (await project()) === before);
    const singleUndo = await success(["undo"]);
    assert.match(singleUndo, /Undid "Second"/);
    await wait(() => evaluate("fixtureSession.getSnapshot().project.name==='First'"));
    const singleRedo = await success(["redo"]);
    assert.match(singleRedo, /Redid "Second"/);
    await wait(async () => (await project()) === before);
    const validation = await json("validate");
    assert.equal(validation.ok, true);
    assert.match(await success(["validate"]), /valid. No problems found/);
    assert.equal(await project(), before);
    const frame = await json("frame", "00:01", "--width", "160", "--height", "90");
    assert.equal(frame.time, 1);
    assert.ok(frame.path.endsWith("frame-00.01.000.png"));
    const png = await readFile(frame.path);
    assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    assert.equal(png.readUInt32BE(16), 160);
    assert.equal(png.readUInt32BE(20), 90);
    assert.equal(png.length, frame.bytes);
    const pixel = await evaluate(
      `(async()=>{const bytes=Uint8Array.from(atob(${JSON.stringify(png.toString("base64"))}),c=>c.charCodeAt(0));const image=await createImageBitmap(new Blob([bytes],{type:'image/png'}));const canvas=document.createElement('canvas');canvas.width=160;canvas.height=90;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);image.close();return Array.from(ctx.getImageData(80,45,1,1).data);})()`,
    );
    assert.ok(pixel[0] > pixel[1] * 2 && pixel[1] > pixel[2], JSON.stringify(pixel));
    const explicitFrame = await success([
      "project",
      "frame",
      "0.5s",
      "--width",
      "160",
      "--height",
      "90",
      "-o",
      "CLI shot.png",
    ]);
    assert.match(explicitFrame, /Wrote .*CLI shot.png .* at 00:00.500/);
    const frameFailures = [];
    for (const args of [
      ["frame", "1"],
      ["frame", "99"],
      ["frame", "0", "--width", "0"],
      ["frame", "0", "-o", "../escape.png"],
      ["frame", "1:60"],
      ["frame", "0", "--format", "missing-format"],
    ]) {
      const result = await run(args);
      assert.notEqual(result.code, 0, JSON.stringify(args));
      frameFailures.push({ args, code: result.code });
      assert.equal(await project(), before);
      assert.equal(await revision(), 8);
    }
    assert.deepEqual(await readFile(frame.path), png);
    const evidence = {
      platform: process.platform,
      reference: "735a9b8e162c1f951044baa892d94993869f2e77",
      undo: {
        emptyExit: emptyUndo.code,
        counted: undone.trim(),
        single: singleUndo.trim(),
        visible: true,
      },
      redo: {
        emptyExit: emptyRedo.code,
        counted: redone,
        single: singleRedo.trim(),
        visible: true,
      },
      history: { limited: history, readOnly: true },
      validate: { result: validation, readOnly: true },
      frame: {
        time: frame.time,
        filename: "frame-00.01.000.png",
        width: 160,
        height: 90,
        bytes: png.length,
        centerPixel: pixel,
        explicitReadable: explicitFrame.trim(),
        originalPreserved: true,
      },
      failures,
      frameFailures,
      finalRevision: await revision(),
      limits: [
        "Windows development Electron runtime",
        "Invalid validation exit tested at transport boundary because the coordinator rejects invalid projects",
        "Managed exports paths and SideCut transport codes retained",
        "Native macOS/Linux and reference rendering unverified",
      ],
    };
    await writeFile(
      join(root, "docs/verification/cli-history-review-runtime.json"),
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
