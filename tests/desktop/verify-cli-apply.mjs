// Repository Electron acceptance workflow: build:desktop and dev server :4270.
import { app, BrowserWindow } from "electron";
import { mkdtempSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";

const root = resolve(import.meta.dirname, "../.."),
  profile = mkdtempSync(join(tmpdir(), "sidecut-cli-apply-"));
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
    const initial = await evaluate("JSON.stringify(fixtureSession.projectFile().project)"),
      initialRevision = Number(await success(["status", "--revision"])),
      batch = {
        label: "From file",
        author: "file-author",
        expectedRevision: 999,
        commands: [
          { addTrack: { id: "cli-track", name: "CLI apply", kind: "video" } },
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
          { updateProject: { patch: { name: "CLI applied project" } } },
        ],
      };
    const file = join(profile, "batch with spaces.json");
    await writeFile(file, JSON.stringify(batch));
    const preview = await success([
      "apply",
      file,
      "--expect",
      String(initialRevision),
      "--label",
      "Preview",
      "--dry-run",
    ]);
    assert.match(preview, /Dry run of "Preview"/);
    assert.equal(await evaluate("JSON.stringify(fixtureSession.projectFile().project)"), initial);
    const applied = JSON.parse(
      await success(
        [
          "project",
          "apply",
          "-",
          "--expect",
          String(initialRevision),
          "--key",
          "once",
          "--label",
          "CLI batch",
          "--author",
          "fixture-agent",
          "--json",
        ],
        JSON.stringify(batch),
      ),
    );
    assert.equal(applied.revision, initialRevision + 1);
    assert.equal(applied.author, "fixture-agent");
    assert.deepEqual(applied.added, ["cli-solid"]);
    await wait(() =>
      evaluate(
        "fixtureSession.getSnapshot().project.name==='CLI applied project' && fixtureSession.getSnapshot().project.videoTracks.some(t=>t.id==='cli-track' && t.clips[0]?.id==='cli-solid')",
      ),
    );
    const after = await evaluate("JSON.stringify(fixtureSession.projectFile().project)");
    assert.match(
      await success(["apply", JSON.stringify(batch), "--key", "once"]),
      /same idempotency key/,
    );
    assert.equal(await evaluate("JSON.stringify(fixtureSession.projectFile().project)"), after);
    assert.equal(
      (await run(["apply", JSON.stringify(batch), "--expect", String(initialRevision)])).code,
      4,
    );
    const failed = await run([
      "apply",
      JSON.stringify([
        { updateProject: { patch: { name: "Should roll back" } } },
        { removeClip: { clipID: "missing" } },
      ]),
    ]);
    assert.equal(failed.code, 2);
    assert.equal(await evaluate("JSON.stringify(fixtureSession.projectFile().project)"), after);
    await success(["undo"]);
    assert.equal(await evaluate("JSON.stringify(fixtureSession.projectFile().project)"), initial);
    const inline = JSON.parse(
      await success([
        "apply",
        JSON.stringify({ updateProject: { patch: { name: "Inline applied" } } }),
        "--label",
        "Inline",
        "--json",
      ]),
    );
    assert.equal(inline.author, "runtime-cli");
    await wait(() => evaluate("fixtureSession.getSnapshot().project.name==='Inline applied'"));
    await success(["undo"]);
    assert.equal(await evaluate("JSON.stringify(fixtureSession.projectFile().project)"), initial);
    const evidence = {
      platform: process.platform,
      reference: "735a9b8e162c1f951044baa892d94993869f2e77",
      initialRevision,
      preview,
      applied,
      filePreviewUnchanged: true,
      stdinApplied: true,
      visibleClip: "cli-solid",
      inlineApplied: inline,
      environmentAuthor: inline.author,
      idempotentRetryUnchanged: true,
      staleExitCode: 4,
      invalidBatchExitCode: failed.code,
      atomicFailureUnchanged: true,
      batchUndo: true,
      inlineUndo: true,
      finalRevision: Number(await success(["status", "--revision"])),
      limits: [
        "Windows development Electron runtime",
        "Native reference execution and installed launchers unverified",
        "Service-generated labels and transport errors retain SideCut conventions",
      ],
    };
    await writeFile(
      join(root, "docs/verification/cli-apply-runtime.json"),
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
