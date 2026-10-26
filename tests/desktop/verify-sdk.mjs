// Electron host + standalone built SDK subprocess acceptance.
import { app, BrowserWindow } from "electron";
import { mkdtempSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
const root = resolve(import.meta.dirname, "../.."),
  profile = mkdtempSync(join(tmpdir(), "sidecut-sdk-runtime-"));
app.setPath("userData", profile);
app.setAppPath(join(root, "apps/desktop"));
process.env.SIDECUT_RENDERER_URL = "http://127.0.0.1:4270";
let exitCode = 0;
async function wait(predicate) {
  const until = Date.now() + 30000;
  while (Date.now() < until) {
    if (await predicate()) return;
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error("SDK runtime timed out");
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
    const evaluate = (code) => window.webContents.executeJavaScript(code, true);
    await wait(() =>
      evaluate("Boolean(document.querySelector('.editor-workspace'))").catch(() => false),
    );
    const endpointFile = join(profile, "current.tandem.api.json"),
      endpoint = JSON.parse(await readFile(endpointFile, "utf8"));
    const call = async (operation, input = {}) => {
      const response = await fetch(`http://127.0.0.1:${endpoint.port}/v1/${operation}`, {
        method: "POST",
        headers: { authorization: `Bearer ${endpoint.token}`, "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      const result = await response.json();
      assert.equal(response.status, 200, JSON.stringify(result));
      return result;
    };
    const initial = (await call("timeline", { format: "json" })).project;
    await call("apply", {
      commands: [
        { updateSettings: { patch: { width: 320, height: 180 } } },
        ...[...initial.videoTracks, ...initial.audioTracks].map((track) => ({
          removeTrack: { trackID: track.id },
        })),
        { addTrack: { id: "picture", kind: "video", name: "Picture" } },
        { addTrack: { id: "captions", kind: "video", name: "Captions" } },
        {
          insertClip: {
            trackID: "picture",
            clip: {
              id: "colour",
              duration: 2,
              content: { solid: { color: { r: 0.1, g: 0.3, b: 0.5, a: 1 } } },
            },
          },
        },
        {
          insertClip: {
            trackID: "captions",
            clip: {
              id: "caption",
              duration: 2,
              content: {
                text: {
                  text: "Comics, news models!",
                  words: [
                    { text: "Comics,", start: 0, end: 0.5 },
                    { text: "news", start: 0.5, end: 1 },
                    { text: "models!", start: 1, end: 1.5 },
                  ],
                },
              },
            },
          },
        },
      ],
    });
    const projectPath = (await call("status")).path;
    const run = (body) =>
      new Promise((done, reject) => {
        const child = spawn(
          process.execPath,
          [
            "--input-type=module",
            "--eval",
            `import assert from 'node:assert/strict';import {openProjectClient,SideCutClient,cmd,fixCaptionWords,ServiceError} from ${JSON.stringify(pathToFileURL(join(root, "packages/client/dist/node.mjs")).href)};const t=await openProjectClient(${JSON.stringify(projectPath)},{endpointFile:${JSON.stringify(endpointFile)},author:'sdk-runtime'});${body}`,
          ],
          {
            cwd: profile,
            env: {
              ...process.env,
              ELECTRON_RUN_AS_NODE: "1",
              SIDECUT_PROJECT: "",
              TANDEM_PROJECT: "",
            },
            windowsHide: true,
          },
        );
        let out = "",
          err = "";
        child.stdout.on("data", (data) => (out += data));
        child.stderr.on("data", (data) => (err += data));
        child.on("error", reject);
        child.on("close", (code) => {
          try {
            assert.equal(code, 0, err);
            done(JSON.parse(out));
          } catch (error) {
            reject(error);
          }
        });
      });
    const edited = await run(
      `const p=await t.project();const {commands,changes}=fixCaptionWords(p,{comics:'Convex','news models':'Muse models'});assert.equal(commands.length,1);const preview=await t.edit('Preview captions',commands,{dryRun:'only'});assert.equal(t.revision,p.revision);const result=await t.edit('Fix captions',commands,{idempotencyKey:'sdk-caption-once'});const after=await t.project();assert.equal(after.clip('caption').content.text.text,'Convex, Muse models!');assert.equal(after.at(0)[0].id,'caption');console.log(JSON.stringify({preview,result,changes,text:after.captions()[0].text,revision:t.revision,tracks:after.tracks.length,author:(await t.history()).find(item=>item.label==='Fix captions').author}));`,
    );
    assert.equal(edited.author, "sdk-runtime");
    await wait(() =>
      evaluate(
        "Boolean([...document.querySelectorAll('.editor-clip-label')].find(e=>e.textContent==='Convex, Muse models!'))",
      ),
    );
    assert.equal((await call("status")).revision, edited.revision);
    const rendered = await run(
      `const frame=await t.frame(0,'sdk-frame.png');const frames=await t.frames({times:[0,0.5],width:96},'sdk-frames.png');const movie=await t.call('export',{preset:'final',from:0,to:0.3,output:'sdk-movie.mp4'});const check=await t.check({quick:true});console.log(JSON.stringify({frame,frames,movie,check}));`,
    );
    const frameBytes = await readFile(rendered.frame.path);
    assert.equal(frameBytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    assert.equal(frameBytes.readUInt32BE(16), 320);
    assert.ok((await readFile(rendered.movie.path)).length > 0);
    const conflict = await run(
      `const p=await t.project();const other=await openProjectClient(${JSON.stringify(projectPath)},{endpointFile:${JSON.stringify(endpointFile)}});await other.edit('Concurrent metadata',[cmd.updateProject({patch:{metadata:{competitor:"true"}}})]);let failure;try{await t.edit('Stale caption',[cmd.updateClip({clipID:'caption',patch:{name:'stale'}})]);}catch(error){assert.ok(error instanceof ServiceError);assert.equal(error.code,'staleRevision');failure={code:error.code,revision:error.revision};}assert.ok(failure);await t.status();await t.undo();await t.undo();console.log(JSON.stringify({failure,revision:t.revision,caption:(await t.project()).captions()[0].text}));`,
    );
    assert.equal(conflict.caption, "Comics, news models!");
    await wait(() =>
      evaluate(
        "Boolean([...document.querySelectorAll('.editor-clip-label')].find(e=>e.textContent==='caption'))",
      ),
    );
    const evidence = {
      platform: process.platform,
      reference: "735a9b8e162c1f951044baa892d94993869f2e77",
      transport: "built Node ESM SDK subprocess to real Electron/browser owner",
      edited,
      rendered: {
        frame: {
          width: frameBytes.readUInt32BE(16),
          height: frameBytes.readUInt32BE(20),
          signature: true,
        },
        frames: {
          times: rendered.frames.times,
          width: rendered.frames.width,
          height: rendered.frames.height,
        },
        movie: { bytes: rendered.movie.bytes, duration: rendered.movie.duration },
        check: rendered.check.ok,
      },
      conflict,
      uiRevisionMatched: true,
      undoVisible: true,
      limits: [
        "Windows development Electron host",
        "SDK connects to existing owner; no headless server startup or release",
        "Project/status/apply/transcript/history/text helpers decode their results; other call results remain unknown",
        "Native upstream SDK runner/Bun globals and all result types are not reproduced",
      ],
    };
    await writeFile(
      join(root, "docs/verification/sdk-runtime.json"),
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
