// Repository Electron acceptance workflow: build:desktop and dev server :4270.
import { app, BrowserWindow, dialog } from "electron";
import { mkdtempSync } from "node:fs";
import { writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
const root = resolve(import.meta.dirname, "../.."),
  profile = mkdtempSync(join(tmpdir(), "sidecut-cli-queries-"));
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
        id: "cli-queries",
        name: "CLI query acceptance",
        media: [
          {
            id: "voice",
            path: "voice.wav",
            kind: "audio",
            role: "camera",
            hasAudio: true,
            duration: 6,
          },
          { id: "missing", path: "absent.wav", kind: "audio", hasAudio: true, duration: 1 },
        ],
        videoTracks: [],
        audioTracks: [
          {
            id: "voice-track",
            kind: "audio",
            name: "Voice",
            clips: [
              {
                id: "spoken",
                start: 1,
                duration: 2,
                sourceStart: 0,
                content: { media: { mediaID: "voice" } },
              },
              {
                id: "missing-clip",
                start: 3,
                duration: 1,
                content: { media: { mediaID: "missing" } },
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
    const file=new File([Uint8Array.from(atob(${JSON.stringify(wav.toString("base64"))}),c=>c.charCodeAt(0))],'voice.wav',{type:'audio/wav'});
    await fixtureSession.stageServiceResource('cli-queries','voice',file,new AbortController().signal);
    const {audioIdentity}=await import(${JSON.stringify(fsRoot + "/packages/platform-browser/src/audio-analysis.ts")});
    const {TRANSCRIPT_VERSION}=await import(${JSON.stringify(fsRoot + "/packages/platform-browser/src/transcription.ts")});
    const {derivedCache}=await import(${JSON.stringify(fsRoot + "/packages/platform-browser/src/derived-cache.ts")});
    await derivedCache(TRANSCRIPT_VERSION+':'+await audioIdentity(file),{model:'fixture',language:'en',words:[{text:'Hello',start:0.2,end:0.5},{text:'world',start:0.6,end:0.9},{text:'Hello',start:4,end:4.3},{text:'world',start:4.4,end:4.8}]});
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
    };
    const json = async (...args) => JSON.parse(await success(...args, "--json"));
    const status = await json("status");
    assert.equal(status.revision, 0);
    assert.match(await success("status"), /CLI query acceptance.*\n  revision 0,/);
    assert.equal(await success("status", "--revision"), "0\n");
    const media = await json("media");
    assert.equal(media.items.find((m) => m.id === "voice").exists, true);
    assert.equal(media.items.find((m) => m.id === "missing").exists, false);
    assert.match(await success("media"), /MISSING FILE/);
    assert.equal((await run("media", "--refresh")).code, 3);
    const timeline = await success("timeline", "--words");
    assert.ok(timeline.includes("Hello world"));
    assert.ok((await json("timeline")).project);
    assert.match(await success("timeline", "--summary"), /CLI query acceptance/);
    const source = await json("transcript", "voice"),
      clip = await json("transcript", "spoken"),
      spoken = await success("transcript", "spoken");
    assert.equal(source.scope, "media");
    assert.equal(source.words.length, 4);
    assert.equal(clip.scope, "clip");
    assert.equal(clip.words.length, 2);
    assert.ok(Math.abs(clip.words[0].start - 1.2) < 0.0001);
    assert.match(spoken, /Transcript of clip spoken \(timeline times\)/);
    const ranged = await json("transcript", "voice", "--from", "4", "--to", "5");
    assert.equal(ranged.words.length, 2);
    assert.match(await success("transcript", "missing"), /no words yet/);
    assert.equal((await run("transcript", "unknown")).code, 5);
    assert.equal((await run("transcript", "--make")).code, 2);
    const made = await json("transcript", "voice", "--make", "--timeout", "0");
    assert.equal(made.words.length, 4);
    assert.equal(made.revision, 0);
    const search = await json("search", "Hello", "world");
    assert.equal(search.phrase, "Hello world");
    assert.ok(search.hits.length);
    assert.ok(search.unused.length);
    assert.ok(search.missing.includes("missing"));
    assert.match(await success("search", "Hello world"), /In the source but not on the timeline/);
    assert.equal((await json("search", "Hello", "--limit", "0")).hits.length, 0);
    assert.ok((await json("search", "Hello", "--limit", "-1")).hits.length);
    assert.equal((await run("search")).code, 2);
    assert.equal((await run("timeline", "--from", "3", "--to", "1")).code, 2);
    assert.equal((await json("status")).revision, 0);
    const watched = join(profile, "watched");
    await mkdir(watched);
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [watched] });
    await evaluate("window.sidecutDesktop.folderSelect()");
    await writeFile(join(watched, "fresh.wav"), wav);
    const refreshed = await json("media", "--refresh");
    assert.equal(refreshed.added.length, 1);
    assert.ok(refreshed.items.some((m) => m.path === "fresh.wav"));
    assert.equal(refreshed.revision, 1);
    const evidence = {
      platform: process.platform,
      status: { revision: status.revision, revisionOnly: true, readable: true },
      media: {
        cached: true,
        missing: true,
        refreshAdded: refreshed.added.length,
        refreshRevision: refreshed.revision,
      },
      timeline: { words: true, summary: true, jsonProject: true },
      transcript: {
        sourceWords: source.words.length,
        clipWords: clip.words.length,
        clipStart: clip.words[0].start,
        rangeWords: ranged.words.length,
        makeCached: true,
      },
      search: {
        phrase: search.phrase,
        hits: search.hits.length,
        unused: search.unused.length,
        missing: search.missing,
        zeroLimit: true,
        negativeLimit: true,
      },
      readOnlyQueries: true,
      limits: [
        "Cached speech; no model download",
        "Windows development runtime; native macOS/Linux unverified",
      ],
    };
    await writeFile(
      join(root, "docs/verification/cli-queries-runtime.json"),
      JSON.stringify(evidence, null, 2) + "\n",
    );
    await writeFile(
      join(root, "docs/verification/cli-queries-editor.png"),
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
