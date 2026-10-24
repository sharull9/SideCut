// Requires the desktop build and the web dev server at 127.0.0.1:4270.
// vp exec --filter @sidecut/desktop electron ../../tests/desktop/verify-interchange.mjs
import { app, BrowserWindow } from "electron";
import { readFile, writeFile, rm } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const profile = mkdtempSync(join(tmpdir(), "sidecut-interchange-"));
app.setPath("userData", profile);
app.setAppPath(join(root, "apps/desktop"));
process.env.SIDECUT_RENDERER_URL = "http://127.0.0.1:4270";
const findings = {};
const evaluate = (window, source) => window.webContents.executeJavaScript(source);
const wait = async (predicate) => {
  const until = Date.now() + 30000;
  while (Date.now() < until) {
    const value = await predicate();
    if (value) return value;
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error("Interchange runtime timed out.");
};
const modulePath = "/src/modules/workspace/browser-session.ts";
const startSession = async (window) => {
  await wait(() =>
    evaluate(window, "Boolean(document.querySelector('[data-testid=project-name]'))").catch(
      () => false,
    ),
  );
  await evaluate(
    window,
    `(async()=>{const {BrowserProjectSession}=await import('${modulePath}');window.fixtureSession=new BrowserProjectSession();await fixtureSession.start();return fixtureSession.getSnapshot().saveState;})()`,
  );
};
const download = async (window) =>
  evaluate(
    window,
    `(async()=>{
  const previous=HTMLAnchorElement.prototype.click;
  let result;
  HTMLAnchorElement.prototype.click=function(){result=fetch(this.href).then(r=>r.arrayBuffer()).then(b=>Array.from(new Uint8Array(b)));};
  try{await fixtureSession.downloadArchive();return await result;}finally{HTMLAnchorElement.prototype.click=previous;}
})()`,
  );
async function verify() {
  try {
    await import("../../apps/desktop/dist/main.mjs");
    await app.whenReady();
    const native = await wait(() => BrowserWindow.getAllWindows()[0]);
    await startSession(native);
    const browser = new BrowserWindow({
      show: false,
      webPreferences: {
        partition: "interchange-browser",
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    await browser.loadURL("http://127.0.0.1:4270/");
    await startSession(browser);
    const audio = await readFile(join(root, "tests/fixtures/audio/speech.wav"));
    findings.browser = await evaluate(
      browser,
      `(async()=>{
    const file={revision:0,project:{id:'prj_runtime_'+crypto.randomUUID(),name:'Portable runtime',media:[{id:'med_runtime',kind:'audio',path:'C:/unavailable/original.wav'}],audioTracks:[{id:'trk_runtime',name:'Voice',kind:'audio',clips:[{id:'clip_runtime',content:{media:{mediaID:'med_runtime'}},start:0,duration:.2,sourceStart:.1}]}]}};
    await fixtureSession.openProject(new File([JSON.stringify(file)],'runtime.tandem'));
    await fixtureSession.relinkMedia('med_runtime',new File([new Uint8Array(${JSON.stringify([...audio])})],'speech.wav',{type:'audio/wav'}));
    return {bridge:typeof window.sidecutDesktop,revision:fixtureSession.getSnapshot().revision,resource:(await fixtureSession.resource('med_runtime')).state};
  })()`,
    );
    assert.equal(findings.browser.bridge, "undefined");
    const browserArchive = await download(browser);
    findings.browserToDesktop = await evaluate(
      native,
      `(async()=>{
    await fixtureSession.openProject(new File([new Uint8Array(${JSON.stringify(browserArchive)})],'portable.sidecut'));
    const state=fixtureSession.getSnapshot(),resource=await fixtureSession.resource('med_runtime');
    return {path:state.project.media[0].path,bytes:resource.file.size,available:resource.state,duration:state.project.audioTracks[0].clips[0].duration.seconds};
  })()`,
    );
    assert.equal(findings.browserToDesktop.bytes, audio.length);
    assert.equal(findings.browserToDesktop.available, "available");
    assert.equal(findings.browserToDesktop.duration, 0.2);
    const desktopArchive = await download(native);
    findings.desktopToBrowser = await evaluate(
      browser,
      `(async()=>{
    await fixtureSession.openProject(new File([new Uint8Array(${JSON.stringify(desktopArchive)})],'return.sidecut'));
    return {bytes:(await fixtureSession.resource('med_runtime')).file.size,path:fixtureSession.getSnapshot().project.media[0].path,clip:fixtureSession.getSnapshot().project.audioTracks[0].clips[0].id};
  })()`,
    );
    assert.equal(findings.desktopToBrowser.bytes, audio.length);
    assert.equal(findings.desktopToBrowser.clip, "clip_runtime");
    const discovery = JSON.parse(await readFile(join(profile, "current.tandem.api.json"), "utf8"));
    const address = `http://127.0.0.1:${discovery.port}/v1/`;
    const call = async (operation, body = {}, headers = {}) =>
      fetch(address + operation, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${discovery.token}`,
          "Content-Type": "application/json",
          ...headers,
        },
        body: JSON.stringify(body),
      });
    const status = await (await call("status")).json();
    const clips = await (await call("clips", { track: "A1", ids: true })).json();
    const denied = await call("media", { refresh: true }, { Origin: "https://unrelated.example" });
    assert.equal(status.name, "Portable runtime");
    assert.equal(clips.clips[0].id, "clip_runtime");
    assert.equal(denied.status, 403);
    findings.service = {
      status: status.name,
      revision: status.revision,
      clip: clips.clips[0].id,
      originRejected: denied.status,
      health: (await fetch(address + "health")).status,
    };
    findings.edl = await evaluate(
      browser,
      `(async()=>{
    await fixtureSession.openProject(new File([JSON.stringify({edl:{segments:[{start:10,end:12,layout:'screen',screen_offset:.25}]},recipe:{name:'EDL runtime',takes:[{start:0,camera:'camera.mov',screen:'screen.mov'}]}})],'recipe.json'));
    const s=fixtureSession.getSnapshot();return {name:s.project.name,source:s.project.videoTracks[0].clips[0].sourceStart.seconds,report:JSON.parse(s.project.metadata.sidecutImportReport)};
  })()`,
    );
    assert.equal(findings.edl.source, 10.25);
    const filmora = await readFile(join(root, "tests/fixtures/tandem/filmora-basic.wfp"));
    findings.filmora = await evaluate(
      browser,
      `(async()=>{
      await fixtureSession.openProject(new File([new Uint8Array(${JSON.stringify([...filmora])})],'synthetic.wfp'));
      const s=fixtureSession.getSnapshot(),clip=s.project.videoTracks[0].clips[0];
      return {name:s.project.name,duration:clip.duration.seconds,sourceStart:clip.sourceStart.seconds,speed:clip.speed,warnings:s.warnings};
    })()`,
    );
    assert.equal(findings.filmora.speed, 2);
    assert.equal(findings.filmora.sourceStart, 1);
    native.setContentSize(1280, 800);
    findings.layout = await evaluate(
      native,
      `({width:innerWidth,archiveRight:[...document.querySelectorAll('button')].find(button=>button.textContent.trim()==='Archive project').getBoundingClientRect().right})`,
    );
    assert.ok(findings.layout.archiveRight <= findings.layout.width);
    await native.webContents
      .capturePage()
      .then((capture) =>
        writeFile(join(root, "docs/verification/phases-116-120-editor.png"), capture.toPNG()),
      );
    await writeFile(
      join(root, "docs/verification/phases-116-120-runtime.json"),
      JSON.stringify(findings, null, 2) + "\n",
    );
    console.log(JSON.stringify(findings));
    await evaluate(browser, "fixtureSession.close()");
    await evaluate(native, "fixtureSession.close()");
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    app.once("will-quit", () => {
      void rm(profile, { recursive: true, force: true });
    });
    app.quit();
  }
}
void verify();
