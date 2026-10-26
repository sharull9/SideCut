import { app, BrowserWindow } from "electron";
import { mkdtempSync } from "node:fs";
import { readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import assert from "node:assert/strict";

const root = resolve(import.meta.dirname, "../.."),
  profile = mkdtempSync(join(tmpdir(), "sidecut-adapters-"));
app.setPath("userData", profile);
app.setAppPath(join(root, "apps/desktop"));
process.env.SIDECUT_RENDERER_URL = "http://127.0.0.1:4270/";
let resultCode = 0;
const wait = async (predicate) => {
  const until = Date.now() + 30000;
  while (Date.now() < until) {
    const value = await predicate();
    if (value) return value;
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error("Adapter acceptance timed out.");
};
async function verify() {
  try {
    await import(pathToFileURL(join(root, "apps/desktop/dist/main.mjs")).href);
    await app.whenReady();
    const window = await wait(() => BrowserWindow.getAllWindows()[0]);
    await wait(() => !window.webContents.isLoading());
    const evaluate = (code) => window.webContents.executeJavaScript(code, true);
    await wait(() => evaluate("Boolean(document.querySelector('.editor-workspace'))"));
    const endpointFile = join(profile, "current.tandem.api.json");
    const discovery = JSON.parse(await readFile(endpointFile, "utf8"));
    const call = async (operation, body = {}, expected = 200) => {
      const response = await fetch(`http://127.0.0.1:${discovery.port}/v1/${operation}`, {
        method: "POST",
        headers: { authorization: `Bearer ${discovery.token}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const value = await response.json();
      assert.equal(response.status, expected, `${operation}: ${JSON.stringify(value)}`);
      return value;
    };
    const cli = async (...args) => {
      const result = await promisify(execFile)(
        process.execPath,
        [join(root, "scripts/sidecut-cli.mjs"), ...args, "--json", "--endpoint-file", endpointFile],
        { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, windowsHide: true },
      );
      return JSON.parse(result.stdout);
    };
    const initial = await call("status");
    const created = await cli(
      "new",
      "--name",
      "Adapter acceptance",
      "--expected-revision",
      String(initial.revision),
    );
    await new Promise((done) => setTimeout(done, 300));
    const edited = await cli(
      "apply",
      "--commands",
      JSON.stringify([
        { updateSettings: { patch: { width: 320, height: 180 } } },
        { addTrack: { id: "picture", name: "Picture", kind: "video" } },
        {
          insertClip: {
            trackID: "picture",
            clip: {
              id: "solid",
              content: { solid: { color: { r: 0.1, g: 0.4, b: 0.7, a: 1 } } },
              duration: 1,
            },
          },
        },
        {
          addMarker: { marker: { id: "comment", name: "Review this", time: 0.2, kind: "comment" } },
        },
      ]),
    );
    const inspected = await cli("status");
    assert.equal(inspected.name, "Adapter acceptance");
    assert.equal(inspected.revision, edited.revision);
    assert.equal((await call("comments")).comments[0].text, "Review this");
    assert.equal((await call("validate")).valid, true);
    assert.equal((await call("check", { quick: true })).frames, 0);
    assert.ok((await call("check", {})).frames > 0);
    const watch = call("watch", { revision: inspected.revision, timeout: 2 });
    await cli("apply", "--commands", JSON.stringify([{ removeMarker: { markerID: "comment" } }]));
    assert.equal((await watch).changed, true);
    assert.equal((await call("watch", { timeout: 0.02 })).changed, false);
    assert.equal((await call("wait", { what: "jobs", timeout: 1 })).done, true);
    const effects = await cli("effects");
    assert.ok(effects.effects.length > 10);
    const starter = await cli("assets", "install-starter");
    assert.equal(starter.downloaded, false);
    const providers = await cli("assets", "providers");
    assert.ok(providers.providers.length > 5);
    const search = await cli("assets", "search", "--limit", "3");
    assert.equal(search.local.length, 3);
    const remote = search.local[0];
    assert.equal((await call("assets-show", { id: remote.id })).asset.id, remote.id);
    await call("assets-fetch", { id: "import:missing-acceptance-asset" }, 404);
    await call("assets-generate", { prompt: "Do not call provider" }, 400);
    const fsRoot = "/@fs/" + root.replaceAll("\\", "/");
    const localID = await evaluate(`(async()=>{
      const {AssetLibrary}=await import(${JSON.stringify(fsRoot + "/packages/platform-browser/src/asset-library.ts")});
      const {decodeAsset}=await import(${JSON.stringify(fsRoot + "/packages/contracts/src/assets.ts")});
      const library=await AssetLibrary.open();
      try { const asset=decodeAsset({provider:'import',providerID:'runtime-svg',kind:'icon',name:'Runtime icon',tags:['runtime'],licenceClass:'noCredit',hasAlpha:true,width:32,height:32,state:'normalised'});
      const file=new File(['<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="blue"/></svg>'],'runtime.svg',{type:'image/svg+xml'});
      await library.put({asset,original:file,normalised:file});return asset.id; } finally {library.close();}
    })()`);
    assert.equal((await call("assets-fetch", { id: localID })).file, "runtime.svg");
    const used = await cli("assets", "use", "--id", localID);
    assert.ok(used.mediaID);
    await call("assets-credits");
    const saved = await cli(
      "segments",
      "save",
      "--name",
      "Runtime solid",
      "--clip-ids",
      '["solid"]',
    );
    const segments = await cli("segments", "list");
    assert.ok(segments.segments.some((s) => s.id === saved.segment.id));
    const inserted = await cli("segments", "insert", "--name", "Runtime solid", "--at", "1");
    assert.ok(inserted.revision > used.revision);
    await writeFile(
      join(profile, "replacement.wav"),
      await readFile(join(root, "tests/fixtures/audio/speech.wav")),
    );
    await call("apply", {
      commands: [
        {
          addMedia: {
            item: { id: "relink-source", path: "missing.wav", kind: "audio", hasAudio: true },
          },
        },
      ],
    });
    const relinked = await cli(
      "relink",
      "--media-id",
      "relink-source",
      "--path",
      "replacement.wav",
    );
    assert.deepEqual(relinked.relinked, ["relink-source"]);
    const archive = await cli("archive", "--output", "acceptance.sidecut");
    const archiveBytes = await readFile(archive.output);
    assert.equal(archiveBytes.readUInt32LE(0), 0x04034b50);
    const exported = await cli(
      "export",
      "--preset",
      "webm",
      "--to",
      "0.1",
      "--output",
      "acceptance.webm",
    );
    assert.ok(exported.bytes > 0);
    const status = await cli("status");
    assert.ok((await evaluate("document.body.innerText")).includes("Adapter acceptance"));
    const evidence = {
      platform: process.platform,
      created: { name: created.name },
      cli: { revision: status.revision, clips: status.clips, exportBytes: exported.bytes },
      review: { commentResolved: (await call("comments")).comments.length === 0, rendered: true },
      watch: { change: true, timeout: true },
      wait: { idle: true },
      resources: {
        effects: effects.effects.length,
        archiveBytes: archiveBytes.length,
        relink: relinked.relinked.length,
      },
      assets: {
        providers: providers.providers.length,
        starter: starter.assets,
        localUse: used.mediaID,
        downloads: false,
        generation: false,
      },
      segments: { saved: true, inserted: true },
      limits: [
        "This harness does not exercise reviewed baselines or sound matching",
        "This harness does not exercise automatic folder relink or standalone-folder archive",
        "No provider network calls or paid generation tested",
        "Windows development runtime; packaging has separate acceptance, native macOS/Linux remain unverified",
      ],
    };
    await writeFile(
      join(root, "docs/verification/phases-126-130-runtime.json"),
      JSON.stringify(evidence, null, 2) + "\n",
    );
    await writeFile(
      join(root, "docs/verification/phases-126-130-editor.png"),
      (await window.webContents.capturePage()).toPNG(),
    );
    console.log(JSON.stringify(evidence));
  } catch (error) {
    console.error(error);
    resultCode = 1;
  } finally {
    app.once("will-quit", (event) => {
      event.preventDefault();
      void rm(profile, { recursive: true, force: true })
        .catch(() => {})
        .finally(() => app.exit(resultCode));
    });
    app.quit();
  }
}
void verify();
