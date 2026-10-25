// Repository Electron acceptance workflow: build:desktop and dev server :4270.
import { app, BrowserWindow } from "electron";
import { mkdtempSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
const root = resolve(import.meta.dirname, "../.."),
  profile = mkdtempSync(join(tmpdir(), "sidecut-cli-helpers-"));
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
    const fixture = {
      revision: 0,
      project: {
        id: "cli-helpers",
        name: "CLI editing helpers",
        settings: { width: 640, height: 360 },
        media: [
          {
            id: "voice",
            path: "voice.wav",
            kind: "audio",
            role: "camera",
            hasAudio: true,
            duration: 6,
          },
          {
            id: "camera",
            path: "camera.png",
            kind: "image",
            role: "camera",
            hasVideo: true,
            width: 320,
            height: 180,
          },
          {
            id: "screen",
            path: "screen.png",
            kind: "image",
            role: "screen",
            hasVideo: true,
            width: 320,
            height: 180,
          },
        ],
        videoTracks: [
          {
            id: "camera-track",
            kind: "video",
            name: "Camera",
            clips: [
              {
                id: "camera-clip",
                start: 0,
                duration: 6,
                content: { media: { mediaID: "camera" } },
                video: { transform: { scale: 0.5 } },
              },
            ],
          },
          {
            id: "screen-track",
            kind: "video",
            name: "Screen",
            clips: [
              {
                id: "screen-clip",
                start: 0,
                duration: 6,
                content: { media: { mediaID: "screen" } },
              },
            ],
          },
        ],
        audioTracks: [
          {
            id: "voice-track",
            kind: "audio",
            name: "Voice",
            clips: [
              {
                id: "a",
                start: 0,
                duration: 3,
                sourceStart: 0,
                content: { media: { mediaID: "voice" } },
              },
              {
                id: "b",
                start: 3,
                duration: 3,
                sourceStart: 3,
                content: { media: { mediaID: "voice" } },
              },
            ],
          },
        ],
      },
    };
    const wav = Buffer.alloc(44 + 96000);
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
    wav.writeUInt32LE(96000, 40);
    const fsRoot = `/@fs/${root.replaceAll("\\", "/")}`;
    await evaluate(`(async()=>{
    const {BrowserProjectSession}=await import('/src/modules/workspace/browser-session.ts');window.fixtureSession=new BrowserProjectSession();await fixtureSession.start();await fixtureSession.openProject(new File([${JSON.stringify(JSON.stringify(fixture))}],'fixture.tandem'));
    const file=new File([Uint8Array.from(atob(${JSON.stringify(wav.toString("base64"))}),c=>c.charCodeAt(0))],'voice.wav',{type:'audio/wav'});await fixtureSession.stageServiceResource('cli-helpers','voice',file,new AbortController().signal);
    const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;
    for(const [id,color]of [['camera','#fbb454'],['screen','#4494ee']]){const context=canvas.getContext('2d');context.fillStyle=color;context.fillRect(0,0,320,180);await fixtureSession.stageServiceResource('cli-helpers',id,new File([await new Promise(done=>canvas.toBlob(done,'image/png'))],id+'.png',{type:'image/png'}),new AbortController().signal);}
    const {audioIdentity}=await import(${JSON.stringify(fsRoot + "/packages/platform-browser/src/audio-analysis.ts")});const {TRANSCRIPT_VERSION}=await import(${JSON.stringify(fsRoot + "/packages/platform-browser/src/transcription.ts")});const {derivedCache}=await import(${JSON.stringify(fsRoot + "/packages/platform-browser/src/derived-cache.ts")});await derivedCache(TRANSCRIPT_VERSION+':'+await audioIdentity(file),{model:'fixture',language:'en',words:[{text:'Hello.',start:0.2,end:0.5},{text:'Again',start:2,end:2.3},{text:'Bye',start:4,end:4.3}]});
  })()`);
    const endpointFile = join(profile, "current.tandem.api.json");
    const run = (...args) =>
      new Promise((done, reject) => {
        const child = spawn(
          process.execPath,
          [join(root, "scripts/sidecut-cli.mjs"), ...args, "--endpoint-file", endpointFile],
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
        child.stdout.on("data", (v) => (out += v));
        child.stderr.on("data", (v) => (err += v));
        child.on("error", reject);
        child.on("close", (code) => done({ code, out, err }));
      });
    const success = async (...args) => {
        const result = await run(...args);
        assert.equal(result.code, 0, result.err);
        return result.out;
      },
      json = async (...args) => JSON.parse(await success(...args, "--json")),
      revision = async () => Number(await success("status", "--revision"));
    const source = await evaluate("JSON.stringify(fixtureSession.projectFile().project)"),
      unchanged = async () =>
        assert.equal(
          await evaluate("JSON.stringify(fixtureSession.projectFile().project)"),
          source,
        );
    const pauses = await json("pauses", "--min", "0.6");
    assert.ok(pauses.pauses.length >= 2);
    assert.match(await success("pauses"), /pause/);
    assert.equal(await revision(), 0);
    assert.equal((await run("pauses", "--min", "0")).code, 2);
    const tight = await json("tighten", "--min", "0.6", "--keep", "0.1");
    assert.ok(tight.cuts.length);
    assert.ok(tight.removed > 0);
    await unchanged();
    const protectedPlan = await json("tighten", "--protect", "1", "--protect", "3");
    assert.equal(protectedPlan.protected.length, 2);
    const rules = await json(
      "tighten",
      "--sentence",
      "0.4",
      "--comma",
      "0.2",
      "--mid",
      "0.1",
      "--mid-min",
      "0.5",
      "--widen",
    );
    assert.equal(rules.sentence, 0.4);
    await json("tighten", "--mike");
    const tightened = await json(
      "tighten",
      "--min",
      "0.6",
      "--keep",
      "0.1",
      "--apply",
      "--expect",
      "0",
      "--label",
      "Trim pauses",
    );
    assert.equal(tightened.applied.revision, 1);
    assert.equal(tightened.applied.author, "cli");
    assert.equal((await run("tighten", "--apply", "--expect", "0")).code, 4);
    await json("undo");
    await unchanged();
    const joins = await json("join");
    assert.equal(joins.joins.length, 1);
    assert.match(await success("join"), /dry run/);
    const joined = await json("join", "--apply", "--expect", String(await revision()));
    assert.equal(joined.applied.revision, 3);
    assert.equal(
      await evaluate("fixtureSession.getSnapshot().project.audioTracks[0].clips.length"),
      1,
    );
    await json("undo");
    await unchanged();
    const caps = await json(
      "captions",
      "--max-words",
      "1",
      "--y",
      "0.8",
      "--track",
      "CLI Captions",
    );
    assert.equal(caps.captions.length, 3);
    await unchanged();
    const captioned = await json(
      "captions",
      "--max-words",
      "1",
      "--y",
      "0.8",
      "--track",
      "CLI Captions",
      "--apply",
      "--expect",
      String(await revision()),
    );
    assert.equal(captioned.applied.revision, 5);
    assert.equal(
      await evaluate(
        "fixtureSession.getSnapshot().project.videoTracks.find(t=>t.name==='CLI Captions').clips.length",
      ),
      3,
    );
    await json("undo");
    await unchanged();
    assert.equal((await run("captions", "--y", "2")).code, 2);
    const short = await json("short");
    assert.deepEqual(short.placed, { top: 1, bottom: 1 });
    await unchanged();
    const laidOut = await json("short", "--apply", "--expect", String(await revision()));
    assert.equal(laidOut.applied.revision, 7);
    assert.equal(
      await evaluate(
        "fixtureSession.getSnapshot().project.settings.alternateFormats.some(f=>f.id==='portrait')",
      ),
      true,
    );
    await json("undo");
    await unchanged();
    const copyPreview = await json("short", "--copy", "-o", "portrait-copy");
    assert.equal(copyPreview.copy, undefined);
    assert.ok(copyPreview.commands.some((c) => c.adoptFormat));
    assert.match(await success("short", "--copy", "-o", "portrait-copy"), /Nothing written yet/);
    const copied = await json("short", "--copy", "-o", "portrait-copy", "--apply");
    const copyFile = JSON.parse(await readFile(copied.copy, "utf8"));
    assert.equal(copyFile.project.settings.width, 1080);
    assert.equal(copyFile.project.settings.height, 1920);
    assert.equal(copyFile.project.name, "portrait-copy");
    assert.equal(copyFile.revision, 8);
    assert.notEqual(copyFile.project.id, fixture.project.id);
    await unchanged();
    assert.equal(await revision(), 8);
    assert.notEqual((await run("short", "--copy", "-o", "portrait-copy", "--apply")).code, 0);
    await json("open", "--path", "exports/portrait-copy.tandem", "--expected-revision", "8");
    await wait(() =>
      evaluate(
        `fixtureSession.getSnapshot().project.id===${JSON.stringify(copyFile.project.id)} && Object.values(fixtureSession.getSnapshot().mediaAvailability).length===3 && Object.values(fixtureSession.getSnapshot().mediaAvailability).every(r=>r.state==='available')`,
      ),
    );
    const reopened = await json("status");
    assert.equal(reopened.width, 1080);
    assert.equal(reopened.height, 1920);
    const evidence = {
      platform: process.platform,
      pauses: { count: pauses.pauses.length, minimum: pauses.minimum },
      tighten: {
        cuts: tight.cuts.length,
        removed: tight.removed,
        protected: protectedPlan.protected.length,
        applied: tightened.applied.revision,
        undo: true,
        rules: { sentence: rules.sentence, comma: rules.comma, mid: rules.mid },
      },
      join: { count: joins.joins.length, applied: joined.applied.revision, undo: true },
      captions: {
        count: caps.captions.length,
        track: caps.track,
        applied: captioned.applied.revision,
        undo: true,
      },
      short: {
        placed: short.placed,
        applied: laidOut.applied.revision,
        undo: true,
        copy: {
          width: copyFile.project.settings.width,
          height: copyFile.project.settings.height,
          name: copyFile.project.name,
          revision: copyFile.revision,
          sourceUnchanged: true,
          overwriteRefused: true,
          reopenedWithResources: true,
        },
        dryRunWritesNothing: true,
      },
      limits: [
        "Cached speech; no model inference",
        "Short-copy resources are local to this profile; archive for portability",
        "Windows development runtime; native macOS/Linux unverified",
      ],
    };
    await writeFile(
      join(root, "docs/verification/cli-helpers-runtime.json"),
      JSON.stringify(evidence, null, 2) + "\n",
    );
    await writeFile(
      join(root, "docs/verification/cli-helpers-editor.png"),
      (await window.webContents.capturePage()).toPNG(),
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
