// Requires build:desktop and the web dev server at 127.0.0.1:4270.
import { app, BrowserWindow } from "electron";
import { mkdtempSync } from "node:fs";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
const root = resolve(import.meta.dirname, "../.."),
  profile = mkdtempSync(join(tmpdir(), "sidecut-resources-")),
  sources = mkdtempSync(join(tmpdir(), "sidecut-relink-sources-"));
app.setPath("userData", profile);
app.setAppPath(join(root, "apps/desktop"));
process.env.SIDECUT_RENDERER_URL = "http://127.0.0.1:4270";
let resultCode = 0;
const evidence = { platform: process.platform };
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
    const evaluate = (code) =>
      window.webContents.executeJavaScript(
        `(async()=>{try{return await (${code})}catch(error){throw new Error(error?.name+': '+error?.message)}})()`,
        true,
      );
    await wait(() =>
      evaluate("Boolean(document.querySelector('.editor-workspace'))").catch(() => false),
    );
    await mkdir(join(sources, "nested"));
    const png = Buffer.from(
      await evaluate(
        "(()=>{const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const context=canvas.getContext('2d');context.fillStyle='red';context.fillRect(0,0,1,1);return canvas.toDataURL('image/png').split(',')[1]})()",
      ),
      "base64",
    );
    await writeFile(join(sources, "nested", "image.png"), png);
    const fixture = {
      revision: 0,
      project: {
        id: "resource-runtime",
        name: "Resources and assets",
        media: [
          {
            id: "image",
            kind: "image",
            role: "image",
            path: "lost/image.png",
            width: 1,
            height: 1,
            hasVideo: true,
          },
          { id: "missing", kind: "audio", path: "lost/absent.wav", hasAudio: true },
        ],
        videoTracks: [
          {
            id: "v",
            kind: "video",
            clips: [
              {
                id: "picture",
                start: 0,
                duration: 2,
                content: { media: { mediaID: "image", sourceStart: 0 } },
              },
            ],
          },
        ],
        audioTracks: [],
      },
    };
    await evaluate(
      `(async()=>{const {BrowserProjectSession}=await import('/src/modules/workspace/browser-session.ts');window.fixtureSession=new BrowserProjectSession();await fixtureSession.start();await fixtureSession.openProject(new File([${JSON.stringify(JSON.stringify(fixture))}],'fixture.tandem'));})()`,
    );
    const discovery = JSON.parse(await readFile(join(profile, "current.tandem.api.json"), "utf8"));
    const call = async (operation, body = {}, expected = 200, signal) => {
      const response = await fetch(`http://127.0.0.1:${discovery.port}/v1/${operation}`, {
        method: "POST",
        headers: { authorization: `Bearer ${discovery.token}`, "content-type": "application/json" },
        body: JSON.stringify(body),
        signal,
      });
      const value = await response.json();
      assert.equal(response.status, expected, `${operation}: ${JSON.stringify(value)}`);
      return value;
    };
    const start = (await call("status")).revision;
    const dry = await call("relink", { search: [sources], dryRun: true });
    assert.equal(dry.revision, start);
    assert.equal(dry.relinked.length, 1);
    assert.equal(dry.missing[0].mediaID, "missing");
    assert.equal(await evaluate("(async()=>!!(await fixtureSession.resource('image')))()"), false);
    await call("relink", { search: [join(sources, "absent")] }, 404);
    const applied = await call("relink", {
      search: [sources],
      label: "Restore image",
      author: "agent",
      expectedRevision: start,
    });
    assert.equal(applied.revision, start + 1);
    await wait(() =>
      evaluate(
        "(async()=>{const r=await fixtureSession.resource('image');return r?.state==='available'&&fixtureSession.getSnapshot().revision>0})()",
      ),
    );
    const decoded = await evaluate(
      "(async()=>{const r=await fixtureSession.resource('image');const image=await createImageBitmap(r.file);const result={width:image.width,height:image.height};image.close();return result})()",
    );
    assert.deepEqual(decoded, { width: 1, height: 1 });
    await call("relink", { search: [sources], expectedRevision: start }, 409);
    await call("undo");
    assert.equal(
      (await call("media", {})).items.find((m) => m.id === "image").path,
      "lost/image.png",
    );
    await call("redo");
    const effects = await call("effects");
    assert.equal(effects.transitions.length, 8);
    assert.equal(effects.layouts.length, 5);
    assert.ok(effects.animatable.includes("audio.gainDB"));
    assert.equal((await call("effects", { type: "BLUR" })).effects[0].type, "blur");
    await call("effects", { type: "missing" }, 404);
    const providers = await call("assets-providers");
    assert.equal(providers.providers.length, 12);
    assert.ok(providers.providers.some((p) => p.id === "iconify" && p.capabilities.search));
    await call("assets-providers", { bad: true }, 400);
    const fsRoot = `/@fs/${root.replaceAll("\\", "/")}`;
    await evaluate(`(async()=>{
      const {AssetLibrary}=await import(${JSON.stringify(fsRoot + "/packages/platform-browser/src/asset-library.ts")});window.assetLibrary=await AssetLibrary.open();
      const {decodeAsset}=await import(${JSON.stringify(fsRoot + "/packages/contracts/src/assets.ts")});
      const cube=['LUT_3D_SIZE 2','0 0 0','1 0 0','0 1 0','1 1 0','0 0 1','1 0 1','0 1 1','1 1 1'].join(String.fromCharCode(10));
      for(let i=0;i<25;i++)await assetLibrary.put({asset:decodeAsset({provider:'import',providerID:'lut'+i,kind:'lut',name:'Runtime LUT '+i,licenceName:'Fixture permission',licenceClass:'noCredit'}),original:new File([cube],'runtime.cube'),licence:new File([i===1?'Plain text fixture licence':JSON.stringify({name:'Fixture permission',licenceClass:'noCredit',holder:'Test fixture'})],'licence.json')});
    })()`);
    const revision = (await call("status")).revision;
    const local = await call("assets-search");
    assert.equal(local.local.length, 20);
    assert.equal(local.total, 25);
    assert.equal((await call("assets-search", { limit: -3 })).local.length, 1);
    const onlineLocal = await call("assets-search", {
      provider: "import",
      kind: "luts",
      online: true,
      limit: 999,
    });
    assert.equal(onlineLocal.total, 25);
    assert.equal(onlineLocal.online[0].assets.length, 25);
    await call("assets-search", { providers: ["unknown"] }, 404);
    await call("assets-search", { kind: "nope" }, 400);
    const failure = await call("assets-search", { provider: "pixabay", online: true });
    assert.ok(failure.online[0].error);
    const fetched = await call("assets-fetch", { id: "import:lut0" });
    assert.equal(fetched.asset.state, "normalised");
    assert.equal(fetched.file, "runtime.cube");
    assert.equal(fetched.licence.name, "Fixture permission");
    assert.equal(fetched.licence.holder, "Test fixture");
    const plainLicence = await call("assets-fetch", { id: "import:lut1" });
    assert.equal(plainLicence.licence.name, "Fixture permission");
    assert.equal(
      await evaluate("(async()=>await (await assetLibrary.get('import:lut1')).licence.text())()"),
      "Plain text fixture licence",
    );
    const cached = await call("assets-fetch", { id: "import:lut0", online: false });
    assert.deepEqual(cached, fetched);
    await call("assets-fetch", { id: "import:missing" }, 404);
    assert.equal((await call("status")).revision, revision);
    // Public provider acceptance is optional only when the network itself is unavailable.
    let publicProvider;
    try {
      const found = await call(
        "assets-search",
        { provider: "iconify", text: "check", online: true, limit: 3 },
        200,
        AbortSignal.timeout(45000),
      );
      const asset = found.local[0] ?? found.online[0]?.assets[0];
      if (!asset)
        publicProvider = { verified: false, error: found.online[0]?.error ?? "No results" };
      else {
        assert.ok(found.local.some((a) => a.id === asset.id));
        await call("assets-fetch", { id: asset.id, online: false }, 400);
        const downloaded = await call(
          "assets-fetch",
          { id: asset.id },
          200,
          AbortSignal.timeout(45000),
        );
        assert.equal(downloaded.asset.state, "normalised");
        assert.ok(downloaded.file);
        assert.deepEqual(await call("assets-fetch", { id: asset.id, online: false }), downloaded);
        publicProvider = {
          verified: true,
          id: asset.id,
          file: downloaded.file,
          licence: downloaded.licence,
        };
      }
    } catch (error) {
      if (error.name !== "TimeoutError" && error.name !== "AbortError") throw error;
      publicProvider = { verified: false, error: error.message };
    }
    assert.equal((await call("status")).revision, revision);
    Object.assign(evidence, {
      relink: {
        dryRun: dry,
        relinked: applied.relinked,
        revision: applied.revision,
        undo: true,
        decoded,
      },
      effects: {
        effects: effects.effects.length,
        transitions: effects.transitions,
        layouts: effects.layouts,
        animatable: effects.animatable,
      },
      providers: providers.providers.map((p) => ({ id: p.id, status: p.status.state })),
      search: {
        defaultLimit: local.local.length,
        total: local.total,
        onlineLocal: onlineLocal.online[0].assets.length,
        providerFailure: failure.online[0].error,
      },
      fetch: {
        file: fetched.file,
        licence: fetched.licence,
        cacheHit: true,
        plainTextLicencePreserved: true,
        projectUnchanged: true,
      },
      publicProvider,
    });
    await writeFile(
      join(root, "docs/verification/resources-assets-runtime.json"),
      JSON.stringify(evidence, null, 2) + "\n",
    );
    await writeFile(
      join(root, "docs/verification/resources-assets-editor.png"),
      (await window.webContents.capturePage()).toPNG(),
    );
    console.log(JSON.stringify(evidence));
  } catch (error) {
    resultCode = 1;
    console.error({ name: error.name, message: error.message, stack: error.stack });
  } finally {
    app.once("will-quit", (event) => {
      event.preventDefault();
      void Promise.allSettled([
        rm(profile, { recursive: true, force: true }),
        rm(sources, { recursive: true, force: true }),
      ]).finally(() => app.exit(resultCode));
    });
    app.quit();
  }
}
void verify();
