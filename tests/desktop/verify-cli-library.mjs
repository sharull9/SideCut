// Requires build:desktop and the web dev server at 127.0.0.1:4270.
import { app, BrowserWindow } from "electron";
import { mkdtempSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
const root = resolve(import.meta.dirname, "../.."),
  profile = mkdtempSync(join(tmpdir(), "sidecut-cli-library-"));
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
    const fixture = {
      revision: 0,
      project: {
        id: "asset-actions",
        name: "Asset actions",
        settings: { width: 640, height: 360 },
        media: [],
        videoTracks: [
          { id: "graphics", name: "Graphics", kind: "video", rippleMode: "follow", clips: [] },
        ],
        audioTracks: [
          { id: "music", name: "Music", kind: "audio", rippleMode: "follow", clips: [] },
        ],
      },
    };
    const fsRoot = `/@fs/${root.replaceAll("\\", "/")}`;
    await evaluate(`(async()=>{
      const {BrowserProjectSession}=await import('/src/modules/workspace/browser-session.ts');window.fixtureSession=new BrowserProjectSession();await fixtureSession.start();await fixtureSession.openProject(new File([${JSON.stringify(JSON.stringify(fixture))}],'fixture.tandem'));
      const {AssetLibrary,normalizeAsset}=await import(${JSON.stringify(fsRoot + "/packages/platform-browser/src/asset-library.ts")});window.assetLibrary=await AssetLibrary.open();
      const {decodeAsset}=await import(${JSON.stringify(fsRoot + "/packages/contracts/src/assets.ts")});
      const canvas=document.createElement('canvas');canvas.width=64;canvas.height=32;canvas.getContext('2d').fillStyle='#ffb454';canvas.getContext('2d').fillRect(0,0,64,32);
      const png=new File([await new Promise(r=>canvas.toBlob(r,'image/png'))],'picture.png',{type:'image/png'});
      for(const [id,kind,licenceClass,line] of [['picture','icon','creditNeeded','Fixture artist'],['sticker','sticker','creditNeeded','Fixture artist']]){
        const asset=decodeAsset({provider:'import',providerID:id,kind,name:id,licenceClass,creditLine:'Old credit',licenceName:'Old licence'});
        await assetLibrary.put(await normalizeAsset(png,asset,new File([JSON.stringify({name:'Fixture licence',licenceClass,creditLine:line})],'licence.json')));
      }
      const bytes=new ArrayBuffer(44+64000),view=new DataView(bytes),text=(offset,s)=>new Uint8Array(bytes,offset,s.length).set(new TextEncoder().encode(s));
      text(0,'RIFF');view.setUint32(4,bytes.byteLength-8,true);text(8,'WAVEfmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,8000,true);view.setUint32(28,16000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);text(36,'data');view.setUint32(40,64000,true);
      for(let i=0;i<32000;i++)view.setInt16(44+i*2,Math.sin(i*0.2)*2000,true);
      await assetLibrary.put({asset:decodeAsset({provider:'import',providerID:'music',kind:'music',name:'Music',licenceClass:'noCredit',creditLine:'Courtesy musician'}),original:new File([bytes],'music.wav',{type:'audio/wav'})});
      await assetLibrary.put({asset:decodeAsset({provider:'import',providerID:'lut',kind:'lut',name:'Look',licenceClass:'noCredit'}),original:new File([['LUT_3D_SIZE 2','0 0 0','1 0 0','0 1 0','1 1 0','0 0 1','1 0 1','0 1 1','1 1 1'].join(String.fromCharCode(10))],'look.cube')});
      await assetLibrary.put({asset:decodeAsset({provider:'elevenlabs',providerID:'sfx_show',kind:'sfx',name:'Metadata only',remote:{prompt:'Fixture prompt',model:'Fixture model'}})});
    })()`);
    const run = (args) =>
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
      });
    const success = async (args) => {
        const r = await run(args);
        assert.equal(r.code, 0, r.err);
        return r.out;
      },
      json = async (...args) => JSON.parse(await success([...args, "--json"])),
      project = () => evaluate("JSON.stringify(fixtureSession.projectFile().project)"),
      revision = async () => Number(await success(["status", "--revision"]));
    const before = await project(),
      providers = await json("assets", "providers");
    assert.equal(providers.providers.length, 12);
    assert.match(await success(["assets", "providers"]), /Asset sources:/);
    const search = await json(
      "assets",
      "search",
      "picture",
      "--kind",
      "icon",
      "--provider",
      "import",
    );
    assert.equal(search.local.length, 1);
    assert.match(await success(["assets", "search", "picture"]), /in the library/);
    const fetched = await json("assets", "fetch", "import:picture");
    assert.equal(fetched.asset.state, "normalised");
    assert.ok(fetched.file);
    assert.match(await success(["assets", "fetch", "import:picture"]), /is ready/);
    const shown = await json("assets", "show", "elevenlabs:sfx_show");
    assert.equal(shown.prompt, "Fixture prompt");
    assert.equal(shown.model, "Fixture model");
    assert.match(await success(["assets", "show", "import:picture"]), /Fixture licence/);
    assert.equal(await project(), before);
    assert.equal(await revision(), 0);
    const starter = await json("assets", "install-starter");
    assert.equal(starter.total, 90);
    assert.deepEqual(starter.counts, { sticker: 43, icon: 32, logo: 15 });
    assert.match(await success(["assets", "install-starter"]), /90 assets/);
    const used = await json(
      "assets",
      "use",
      "import:picture",
      "--at",
      "0",
      "--duration",
      "2",
      "--anchor",
      "bottomRight",
      "--pop",
      "--label",
      "CLI asset",
    );
    assert.equal(used.applied.author, "runtime-cli");
    assert.equal(used.applied.revision, 1);
    await wait(() =>
      evaluate("fixtureSession.getSnapshot().project.videoTracks[0].clips.length===1"),
    );
    const credits = await json("assets", "credits");
    assert.match(credits.text, /Fixture artist/);
    assert.match(await success(["assets", "credits", "--optional"]), /Fixture artist/);
    await json("undo");
    assert.equal(await project(), before);
    const placed = await json("assets", "use", "import:picture", "--at", "0", "--duration", "2");
    const pictureID = placed.applied.createdIDs.find((id) => id.startsWith("clip_"));
    assert.ok(pictureID);
    await json(
      "apply",
      JSON.stringify({
        commands: [
          { addTrack: { id: "text", name: "Text", kind: "video" } },
          {
            insertClip: {
              trackID: "text",
              clip: { id: "title", duration: 1, content: { text: { text: "Original" } } },
            },
          },
        ],
      }),
    );
    const beforeSave = await project(),
      saveRevision = await revision();
    const saved = await json(
      "segments",
      "save",
      "CLI Intro",
      "--clips",
      pictureID + ",title",
      "--field",
      "title=Title",
    );
    assert.equal(saved.segment.name, "CLI Intro");
    assert.ok(saved.copied.length);
    assert.equal(await project(), beforeSave);
    assert.equal(await revision(), saveRevision);
    const listed = await json("segments", "list");
    assert.ok(listed.segments.some((s) => s.name === "CLI Intro"));
    assert.match(await success(["segments"]), /CLI Intro/);
    assert.notEqual((await run(["segments", "save", "CLI Intro", "--clips", "title"])).code, 0);
    await json(
      "segments",
      "save",
      "CLI Intro",
      "--clips",
      pictureID + ",title",
      "--field",
      "title=Title",
      "--replace",
    );
    const field = saved.segment.fields[0].key,
      inserted = await json(
        "segments",
        "insert",
        "CLI Intro",
        "--at",
        "3",
        "--value",
        field + "=Filled",
        "--mode",
        "insert",
        "--label",
        "CLI segment",
        "--expect",
        String(saveRevision),
      );
    assert.equal(inserted.applied.author, "runtime-cli");
    await wait(() =>
      evaluate(
        "fixtureSession.getSnapshot().project.videoTracks.flatMap(t=>t.clips).some(c=>c.content.text?.text==='Filled')",
      ),
    );
    await json("undo");
    assert.equal(await project(), beforeSave);
    const failures = [];
    for (const args of [
      ["assets", "search", "--kind", "nope"],
      ["assets", "search", "--provider", "missing"],
      ["assets", "fetch", "missing"],
      ["assets", "show", "missing"],
      ["assets", "use", "missing"],
      ["assets", "generate", "sfx", "Unconfirmed"],
      ["assets", "generate", "image", "Bad kind"],
      ["segments", "save", "Bad", "--clips", "missing"],
      ["segments", "insert", "Missing", "--at", "0"],
      ["segments", "insert", "CLI Intro"],
    ]) {
      const r = await run(args);
      assert.notEqual(r.code, 0, JSON.stringify(args));
      failures.push({ args, code: r.code });
      assert.equal(await project(), beforeSave);
    }
    await evaluate(`(async()=>{
      const {BrowserAssetProviders}=await import(${JSON.stringify(fsRoot + "/packages/platform-browser/src/asset-providers.ts")});const {AssetProviders}=await import(${JSON.stringify(fsRoot + "/packages/assets/src/index.ts")});
      window.fixtureGenerationCalls=0;const engine=new AssetProviders({mode:'host',hasCredential:async()=>true,request:async()=>{window.fixtureGenerationCalls++;return {status:window.fixtureGenerationCalls===2?500:200,headers:{},bytes:new ArrayBuffer(48000)}}});
      const bridge={providerCall:async(_id,r)=>engine.generate('elevenlabs',r.request,r.confirmedPaid,new AbortController().signal,async()=>{}),providerCancel:async()=>{},providerCredential:async()=>{}};
      const original=BrowserAssetProviders.prototype.generate;window.restoreGeneration=()=>{BrowserAssetProviders.prototype.generate=original;};
      BrowserAssetProviders.prototype.generate=function(request,confirmedPaid,signal){return original.call(new BrowserAssetProviders(assetLibrary,undefined,bridge),request,confirmedPaid,signal);};
    })()`);
    let generated;
    try {
      generated = await json(
        "assets",
        "generate",
        "sfx",
        "Fixture whoosh",
        "--duration",
        "0.5",
        "--variations",
        "2",
        "--confirmed-paid",
        "true",
      );
      assert.equal(generated.assets.length, 1);
      assert.equal(generated.failures.length, 1);
      assert.equal(generated.assets[0].state, "normalised");
      assert.equal(await evaluate("fixtureGenerationCalls"), 2);
    } finally {
      await evaluate("restoreGeneration()");
    }
    assert.equal(await project(), beforeSave);
    Object.assign(evidence, {
      reference: "735a9b8e162c1f951044baa892d94993869f2e77",
      providers: providers.providers.length,
      search: search.local.map((a) => a.id),
      fetch: { id: fetched.asset.id, state: fetched.asset.state },
      show: { prompt: shown.prompt, model: shown.model },
      use: { author: used.applied.author, revision: used.applied.revision, undo: true },
      credits: credits.text,
      starter,
      generate: {
        assets: generated.assets.map((a) => ({ id: a.id, state: a.state })),
        failures: generated.failures,
        transport: "fixture only; no paid requests",
      },
      segments: {
        saved: saved.segment.name,
        copied: saved.copied.length,
        listed: listed.segments.length,
        insertAuthor: inserted.applied.author,
        field: field,
        visible: true,
        undo: true,
      },
      failures,
      limits: [
        "Library commands use the attached browser library rather than a native standalone filesystem library",
        "Generation uses a fixture provider boundary and real normalization; no credentials or paid network calls",
        "No online provider search in this run",
        "Windows runtime; native platforms unverified",
      ],
    });
    await writeFile(
      join(root, "docs/verification/cli-library-runtime.json"),
      JSON.stringify(evidence, null, 2) + "\n",
    );
    console.log(JSON.stringify(evidence));
  } catch (error) {
    resultCode = 1;
    console.error(error);
  } finally {
    app.once("will-quit", () => app.exit(resultCode));
    app.quit();
  }
}
void verify();
