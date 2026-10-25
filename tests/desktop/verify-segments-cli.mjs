// Uses the repository's Electron acceptance workflow; build:desktop + dev server :4270.
import { app, BrowserWindow } from "electron";
import { mkdtempSync } from "node:fs";
import { readFile, writeFile, copyFile, rm } from "node:fs/promises";
import { join, resolve, dirname, basename } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import assert from "node:assert/strict";

const root = resolve(import.meta.dirname, "../.."),
  profile = mkdtempSync(join(tmpdir(), "sidecut-segments-cli-"));
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
    const endpointFile = join(profile, "current.tandem.api.json"),
      endpoint = JSON.parse(await readFile(endpointFile, "utf8"));
    const call = async (name, input = {}, expected = 200) => {
      const response = await fetch(`http://127.0.0.1:${endpoint.port}/v1/${name}`, {
        method: "POST",
        headers: { authorization: `Bearer ${endpoint.token}`, "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      const result = await response.json();
      assert.equal(response.status, expected, `${name}: ${JSON.stringify(result)}`);
      return result;
    };
    const run = async (...args) =>
      (
        await promisify(execFile)(
          process.execPath,
          [join(root, "scripts/sidecut-cli.mjs"), ...args, "--endpoint-file", endpointFile],
          {
            env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
            windowsHide: true,
            maxBuffer: 8 * 1024 * 1024,
          },
        )
      ).stdout;
    const cli = async (...args) => JSON.parse(await run(...args, "--json"));
    const schema = await cli("schema");
    assert.ok(JSON.stringify(schema).includes("updateClip"));
    const service = await cli("schema", "--service");
    assert.ok(service.operations["save-segment"]);
    const created = await cli("new", "CLI project", "--portrait", "--name", "CLI phase acceptance");
    assert.equal(created.width, 1080);
    assert.equal(created.height, 1920);
    assert.equal(created.tracks.length, 8);
    await wait(() => evaluate("document.body.innerText.includes('CLI phase acceptance')"));
    const savedNew = JSON.parse(await readFile(created.path, "utf8"));
    assert.equal(savedNew.project.name, "CLI phase acceptance");
    window.minimize();
    await run("app");
    await wait(() => !window.isMinimized());
    const start = await call("status");
    // The shared project is obtained through the supported timeline endpoint.
    const timeline = await call("timeline", { format: "json" });
    const project = timeline.project ?? timeline;
    const textTrack = project.videoTracks.find((t) => t.name === "Text");
    assert.ok(textTrack);
    await call("apply", {
      expectedRevision: start.revision,
      commands: [
        {
          insertClip: {
            trackID: textTrack.id,
            clip: {
              id: "template-title",
              start: 0,
              duration: 1,
              content: { text: { text: "Original" } },
            },
          },
        },
      ],
    });
    const beforeSave = (await call("status")).revision;
    const saved = await cli(
      "segments",
      "save",
      "CLI title",
      "--clips",
      "template-title",
      "--field",
      "template-title=Section title",
    );
    assert.equal(saved.segment.clips, 1);
    assert.equal(saved.segment.fields[0].key, "sectionTitle");
    assert.equal((await call("status")).revision, beforeSave);
    const listed = await cli("segments", "list");
    assert.ok(listed.segments.some((s) => s.name === "CLI title"));
    const inserted = await cli(
      "segments",
      "insert",
      "CLI title",
      "--at",
      "2",
      "--value",
      "sectionTitle=Runtime override",
      "--expect",
      String(beforeSave),
    );
    assert.equal(inserted.applied.revision, beforeSave + 1);
    const afterInsert = await call("timeline", { format: "json" });
    assert.ok(JSON.stringify(afterInsert).includes("Runtime override"));
    const insertedProject = afterInsert.project ?? afterInsert;
    const insertedTitle = insertedProject.videoTracks
      .flatMap((t) => t.clips)
      .find((c) => c.content.text?.text === "Runtime override");
    assert.ok(insertedTitle);
    const selector = `[data-clip-id="${insertedTitle.id}"] .editor-clip-body`;
    await wait(() => evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`));
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
    await wait(() => evaluate("Boolean(document.querySelector('#inspector-tab-text'))"));
    await evaluate("document.querySelector('#inspector-tab-text').click()");
    await wait(() =>
      evaluate(
        "Array.from(document.querySelectorAll('textarea')).some(input=>input.value==='Runtime override')",
      ),
    );
    await call("undo", {});
    assert.ok(
      !JSON.stringify(await call("timeline", { format: "json" })).includes("Runtime override"),
    );
    const beforeFailure = (await call("status")).revision;
    await call("save-segment", { name: "Invalid", clipIDs: ["missing"] }, 404);
    assert.equal((await call("status")).revision, beforeFailure);
    await call("insert-segment", { name: "CLI title", at: 3, expectedRevision: 999 }, 409);
    assert.equal((await call("status")).revision, beforeFailure);
    const readable = await run("segments", "list");
    assert.ok(readable.includes("CLI title"));
    const help = await run("help", "segments");
    assert.ok(help.includes("--field"));
    await writeFile(
      join(profile, "recipe.json"),
      JSON.stringify({ name: "EDL runtime", takes: [{ start: 0, camera: "camera.mov" }] }),
    );
    await writeFile(
      join(profile, "edl.json"),
      JSON.stringify({ segments: [{ start: 0, end: 1, layout: "cam" }] }),
    );
    const edl = await cli(
      "import",
      "edl",
      "edl.json",
      "--recipe",
      "recipe.json",
      "--out",
      "edl-result",
    );
    assert.equal(edl.name, "EDL runtime");
    assert.equal(edl.report.clips, 2);
    await wait(() => evaluate("document.body.innerText.includes('EDL runtime')"));
    await copyFile(
      join(root, "tests/fixtures/tandem/filmora-basic.wfp"),
      join(profile, "filmora.wfp"),
    );
    const filmora = await cli(
      "import",
      "filmora",
      "filmora.wfp",
      "--out",
      "filmora-result",
      "--name",
      "Filmora CLI runtime",
      "--keep-levels",
    );
    assert.equal(filmora.name, "Filmora CLI runtime");
    await wait(() => evaluate("document.body.innerText.includes('Filmora CLI runtime')"));
    assert.equal(
      JSON.parse(await readFile(filmora.path, "utf8")).project.name,
      "Filmora CLI runtime",
    );
    await window.webContents.reload();
    await wait(() =>
      evaluate("document.body.innerText.includes('Filmora CLI runtime')").catch(() => false),
    );
    const evidence = {
      platform: process.platform,
      date: new Date().toISOString(),
      phases: [
        "129.09",
        "129.10",
        "129.11",
        "130.01",
        "130.02",
        "130.03",
        "130.04",
        "130.05",
        "130.06",
        "130.07",
      ],
      new: {
        canvas: [created.width, created.height],
        tracks: created.tracks.length,
        snapshot: true,
        editor: true,
      },
      app: { restored: true },
      schema: { offlineCommands: true, serviceExtension: true },
      segments: {
        savedWithoutRevision: true,
        fields: true,
        insertedInOneRevision: true,
        visible: true,
        undo: true,
        failuresNonmutating: true,
        readableOutput: true,
      },
      imports: {
        edlClips: edl.report.clips,
        filmoraClips: filmora.report.clips,
        snapshots: true,
        persistedAfterReload: true,
      },
      limits: [
        "Windows development runtime; installed launch and native macOS/Linux unverified",
        "Running shared host authority; headless editing not implemented",
        "No native reference-runtime response capture",
      ],
    };
    await writeFile(
      join(root, "docs/verification/segments-cli-runtime.json"),
      JSON.stringify(evidence, null, 2) + "\n",
    );
    await writeFile(
      join(root, "docs/verification/segments-cli-editor.png"),
      (await window.webContents.capturePage()).toPNG(),
    );
    console.log(JSON.stringify(evidence));
  } catch (error) {
    exitCode = 1;
    console.error(error);
  } finally {
    app.once("will-quit", (event) => {
      event.preventDefault();
      const target = resolve(profile);
      if (
        dirname(target) !== resolve(tmpdir()) ||
        !basename(target).startsWith("sidecut-segments-cli-")
      ) {
        app.exit(1);
        return;
      }
      void rm(target, { recursive: true, force: true, maxRetries: 0 })
        .catch(() => console.error("Temporary profile cleanup incomplete:", target))
        .finally(() => app.exit(exitCode));
    });
    app.quit();
  }
}
void verify();
