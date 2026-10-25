// Requires build:desktop and the web dev server at 127.0.0.1:4270.
import { app, BrowserWindow } from "electron";
import { mkdtempSync } from "node:fs";
import { readFile, writeFile, rm } from "node:fs/promises";
import { join, resolve, dirname, basename } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
const root = resolve(import.meta.dirname, "../.."),
  profile = mkdtempSync(join(tmpdir(), "sidecut-asset-actions-"));
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
    const discovery = JSON.parse(await readFile(join(profile, "current.tandem.api.json"), "utf8"));
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
    const shown = await call("assets-show", { id: "elevenlabs:sfx_show" });
    assert.equal(shown.prompt, "Fixture prompt");
    assert.equal(shown.model, "Fixture model");
    assert.equal(shown.file, undefined);
    await call("assets-show", { id: "missing" }, 404);
    assert.equal((await call("status")).revision, 0);
    const starter = await call("assets-install-starter");
    assert.equal(starter.total, 90);
    assert.deepEqual(starter.counts, { sticker: 43, icon: 32, logo: 15 });
    assert.deepEqual(await call("assets-install-starter"), starter);
    await call("assets-install-starter", { unexpected: true }, 400);
    assert.equal(
      await evaluate(
        "(async()=>(await assetLibrary.entries()).filter(e=>e.asset.tags.includes('starter')&&(e.original||e.normalised)).length)()",
      ),
      0,
    );
    const used = await call("assets-use", {
      id: "import:picture",
      at: 0,
      duration: 2,
      anchor: "bottomRight",
      pop: true,
      label: "Place picture",
      author: "agent",
      expectedRevision: 0,
    });
    assert.equal(used.revision, 1);
    assert.equal(used.applied.label, "Place picture");
    assert.equal(used.role, "graphic");
    assert.equal(used.licence.creditLine, "Fixture artist");
    const placed = await evaluate("fixtureSession.getSnapshot().project.videoTracks[0].clips[0]");
    assert.equal(placed.keyframes["video.transform.scale"].length, 6);
    await call("undo");
    assert.equal((await call("media")).items.length, 0);
    assert.equal((await call("clips")).clips.length, 0);
    await call("redo");
    await call("apply", {
      commands: [{ updateMedia: { mediaID: used.mediaID, patch: { asset: null } } }],
    });
    const before = (await call("status")).revision;
    assert.equal((await call("assets-use", { id: "import:picture" })).revision, before);
    await call("assets-use", { id: "import:picture", at: 1, duration: 1 }, 400);
    assert.equal((await call("status")).revision, before);
    await call("assets-use", { id: "import:picture", at: 1, mode: "overwrite", duration: 1 });
    await call("assets-use", { id: "import:picture", at: 1, mode: "insert", duration: 1 });
    assert.equal((await call("media")).items.length, 1);
    await call("assets-use", { id: "import:picture", at: 4, anchor: "wrong" }, 400);
    await call("assets-use", { id: "missing" }, 404);
    await call("assets-use", { id: "import:picture", expectedRevision: 0 }, 409);
    const sticker = await call("assets-use", { id: "import:sticker", at: 4, pop: true });
    assert.equal(sticker.role, "sticker");
    const music = await call("assets-use", { id: "import:music", at: 0, duration: 2 });
    assert.equal(music.gainDB, -31);
    assert.equal(music.trackName, "Music");
    const audio = await evaluate(
      "fixtureSession.getSnapshot().project.audioTracks[0].clips[0].audio",
    );
    assert.equal(audio.gainDB, -31);
    assert.equal(audio.fadeOut, 2);
    const lut = await call("assets-use", { id: "import:lut" });
    assert.ok(lut.lut);
    assert.equal(lut.mediaID, undefined);
    assert.equal(
      await evaluate(
        `(async()=>!!(await fixtureSession.resource(${JSON.stringify("lut:")}+${JSON.stringify(lut.lut)})))()`,
      ),
      true,
    );
    const fontBytes = await readFile("C:/Windows/Fonts/arial.ttf").catch(() => null);
    let font;
    if (fontBytes) {
      await evaluate(
        `(async()=>{const {decodeAsset}=await import(${JSON.stringify(fsRoot + "/packages/contracts/src/assets.ts")});await assetLibrary.put({asset:decodeAsset({provider:'import',providerID:'font',kind:'font',name:'Fixture font',licenceClass:'noCredit'}),original:new File([Uint8Array.from(atob(${JSON.stringify(fontBytes.toString("base64"))}),c=>c.charCodeAt(0))],'fixture.ttf'),licence:new File(['Installed Windows font used for local verification'],'licence.txt')})})()`,
      );
      font = await call("assets-use", { id: "import:font" });
      assert.ok(font.fonts.length);
      assert.equal(font.fontsReached, "app");
      assert.equal(font.mediaID, undefined);
    }
    const credits = await call("assets-credits");
    assert.equal(credits.text, "Credits\nFixture artist");
    assert.equal(credits.credits.entries.filter((e) => e.line === "Fixture artist").length, 1);
    assert.equal(
      credits.credits.entries.find((e) => e.line === "Fixture artist").assetIDs.length,
      2,
    );
    const optional = await call("assets-credits", { includeOptional: true });
    assert.ok(optional.text.includes("Thanks to\nCourtesy musician"));
    await call("assets-generate", { kind: "sfx", prompt: "Unconfirmed" }, 400);
    await call("assets-generate", { kind: "image", prompt: "Invalid", confirmedPaid: true }, 400);
    await call(
      "assets-generate",
      { kind: "music", prompt: "Too short", duration: 2, confirmedPaid: true },
      400,
    );
    const revision = (await call("status")).revision;
    const generation = await evaluate(`(async()=>{
      const {BrowserAssetProviders}=await import(${JSON.stringify(fsRoot + "/packages/platform-browser/src/asset-providers.ts")});
      const {AssetProviders}=await import(${JSON.stringify(fsRoot + "/packages/assets/src/index.ts")});
      let calls=0,broken=false;const bodies=[];
      const engine=new AssetProviders({mode:'host',hasCredential:async()=>true,request:async(r)=>{calls++;bodies.push(JSON.parse(r.body));return {status:!broken&&calls===2?500:200,headers:{},bytes:new ArrayBuffer(broken?3:48000)}}});
      const bridge={providerCall:async(_id,r)=>{if(r.operation!=='generate')throw new Error('Unexpected fixture operation');return engine.generate('elevenlabs',r.request,r.confirmedPaid,new AbortController().signal,async()=>{})},providerCancel:async()=>{},providerCredential:async()=>{}};
      const provider=new BrowserAssetProviders(assetLibrary,undefined,bridge),signal=new AbortController().signal;
      const first=await provider.generate({kind:'sfx',prompt:'Fixture click',duration:0.5,variations:2},true,signal);
      broken=true;const second=await provider.generate({kind:'sfx',prompt:'Broken fixture',duration:0.5,loop:true},true,signal);
      return {first:{assets:first.entries.map(e=>e.asset),failures:first.failures},second:{assets:second.entries.map(e=>e.asset),failures:second.failures},bodies,calls};
    })()`);
    assert.equal(generation.first.assets.length, 1);
    assert.equal(generation.first.assets[0].state, "normalised");
    assert.equal(generation.first.failures.length, 1);
    assert.equal(generation.second.assets.length, 1);
    assert.equal(generation.second.assets[0].state, "original");
    assert.equal(generation.second.failures.length, 1);
    assert.equal(generation.calls, 3);
    const original = await call("assets-show", { id: generation.second.assets[0].id });
    assert.equal(original.prompt, "Broken fixture");
    assert.ok(original.original);
    assert.equal(original.file, undefined);
    assert.equal((await call("status")).revision, revision);
    Object.assign(evidence, {
      show: { prompt: shown.prompt, model: shown.model, readOnly: true },
      starter: {
        counts: starter.counts,
        total: starter.total,
        idempotent: true,
        downloaded: false,
      },
      use: {
        revision: used.revision,
        oneUndoStep: true,
        reusedMedia: true,
        overwrite: true,
        insert: true,
        failedPlacementAtomic: true,
        anchorPop: true,
        music: audio,
        lut: lut.lut,
        font: font?.fonts,
      },
      credits,
      optionalText: optional.text,
      generation: {
        ...generation,
        transport: "fixture only; no paid requests",
        failedOriginal: original.original,
        projectUnchanged: true,
      },
    });
    await writeFile(
      join(root, "docs/verification/asset-actions-runtime.json"),
      JSON.stringify(evidence, null, 2) + "\n",
    );
    await writeFile(
      join(root, "docs/verification/asset-actions-editor.png"),
      (await window.webContents.capturePage()).toPNG(),
    );
    console.log(JSON.stringify(evidence));
  } catch (error) {
    resultCode = 1;
    console.error({ name: error.name, message: error.message, stack: error.stack });
  } finally {
    app.once("will-quit", (event) => {
      event.preventDefault();
      const target = resolve(profile);
      if (
        dirname(target) !== resolve(tmpdir()) ||
        !basename(target).startsWith("sidecut-asset-actions-")
      ) {
        app.exit(1);
        return;
      }
      void Promise.allSettled([rm(target, { recursive: true, force: true, maxRetries: 0 })]).then(
        (results) => {
          if (results[0].status === "rejected")
            console.error("Temporary profile cleanup incomplete:", target);
          app.exit(resultCode);
        },
      );
    });
    app.quit();
  }
}
void verify();
