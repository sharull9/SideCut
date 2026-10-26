// Repository Electron acceptance workflow: build:desktop and dev server :4270.
import { app, BrowserWindow } from "electron";
import { mkdtempSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
const root = resolve(import.meta.dirname, "../.."),
  profile = mkdtempSync(join(tmpdir(), "sidecut-cli-cards-"));
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
    fixture.project.markers = [
      { id: "first", kind: "section", name: "First", time: 1 },
      { id: "second", kind: "section", name: "Next", note: "Subtitle", time: 2 },
    ];
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
    const preview = await json("cards", "--no-sounds");
    assert.equal(preview.cards.length, 2);
    assert.equal(preview.applied, undefined);
    assert.match(await success("cards", "--no-sounds"), /2 section cards \(dry run/);
    await unchanged();
    assert.equal(await revision(), 0);
    const selected = await json(
      "project",
      "cards",
      "--marker",
      "second",
      "--marker",
      "second",
      "--duration",
      "3.2",
      "--kicker",
      "Chapter",
      "--track",
      "camera-track",
      "--insert",
      "--no-sounds",
    );
    assert.equal(selected.cards.length, 1);
    assert.equal(selected.cards[0].subtitle, "Subtitle");
    assert.ok(selected.cards[0].cut < selected.cards[0].at);
    assert.deepEqual(selected.commands[0].addSectionCards.markerIDs, ["second", "second"]);
    assert.equal(selected.commands[0].addSectionCards.kicker, "Chapter");
    assert.equal(selected.commands[0].addSectionCards.trackID, "camera-track");
    assert.equal(selected.commands[0].addSectionCards.mode, "insert");
    assert.match(
      await success("cards", "--marker", "second", "--insert", "--no-sounds"),
      /take cut at/,
    );
    await unchanged();
    const failures = [];
    for (const args of [
      ["--duration", "0.1"],
      ["--marker", "missing"],
      ["--track", "voice-track"],
      ["--unknown", "value"],
      ["extra"],
    ]) {
      const failure = await run("cards", ...args, "--apply");
      assert.notEqual(failure.code, 0);
      assert.match(failure.err, /^Error:/);
      failures.push({ args, code: failure.code });
      await unchanged();
      assert.equal(await revision(), 0);
    }
    const placed = await json(
      "cards",
      "--marker",
      "first",
      "--marker",
      "second",
      "--no-sounds",
      "--apply",
      "--expect",
      "0",
      "--label",
      "CLI cards",
      "--author",
      "fixture-agent",
    );
    assert.equal(placed.applied.revision, 1);
    assert.equal(placed.applied.label, "CLI cards");
    assert.equal(placed.applied.author, "fixture-agent");
    await wait(() =>
      evaluate(
        "fixtureSession.getSnapshot().project.videoTracks.some(t=>t.name==='Graphics' && t.clips.length===2)",
      ),
    );
    const appliedProject = await evaluate("JSON.stringify(fixtureSession.projectFile().project)");
    assert.equal((await run("cards", "--apply", "--expect", "0")).code, 4);
    assert.equal(
      await evaluate("JSON.stringify(fixtureSession.projectFile().project)"),
      appliedProject,
    );
    assert.match(await success("cards", "--marker", "second"), /already there, renumbered/);
    await json("undo");
    await unchanged();
    assert.equal(await revision(), 2);
    const inserted = await json(
      "cards",
      "--marker",
      "second",
      "--insert",
      "--no-sounds",
      "--apply",
      "--expect",
      "2",
    );
    assert.equal(inserted.applied.revision, 3);
    assert.equal(inserted.cards[0].cut, selected.cards[0].cut);
    await json("undo");
    await unchanged();
    const evidence = {
      platform: process.platform,
      reference: "735a9b8e162c1f951044baa892d94993869f2e77",
      preview: { count: preview.cards.length, revision: preview.revision, unchanged: true },
      selected: { card: selected.cards[0], command: selected.commands[0], sounds: selected.sounds },
      applied: placed.applied,
      visibleCards: 2,
      staleExitCode: 4,
      existingCardReadable: true,
      failures,
      overwriteUndo: true,
      insertUndo: true,
      finalRevision: await revision(),
      limits: [
        "Windows development Electron runtime",
        "Cached speech; no model download",
        "No sound-library acquisition or native macOS/Linux comparison",
      ],
    };
    await writeFile(
      join(root, "docs/verification/cli-cards-runtime.json"),
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
