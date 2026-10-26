// Repository Electron acceptance workflow: build:desktop and dev server :4270.
import { app, BrowserWindow } from "electron";
import { mkdtempSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import assert from "node:assert/strict";
const root = resolve(import.meta.dirname, "../.."),
  profile = mkdtempSync(join(tmpdir(), "sidecut-mcp-adapters-"));
app.setPath("userData", profile);
app.setAppPath(join(root, "apps/desktop"));
process.env.SIDECUT_RENDERER_URL = "http://127.0.0.1:4270";
let exitCode = 0;
let client;
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
        settings: { width: 320, height: 180 },
        media: [
          {
            id: "take",
            path: "take.wav",
            kind: "video",
            role: "camera",
            hasAudio: true,
            hasVideo: true,
            duration: 6,
          },
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
      { id: "section", kind: "section", name: "Next", time: 2 },
      { id: "comment", kind: "comment", name: "Review", time: 3 },
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
    for (let i = 0; i < 48000; i++)
      wav.writeInt16LE(Math.round(Math.sin(i * 0.2) * 4000), 44 + i * 2);
    const fsRoot = `/@fs/${root.replaceAll("\\", "/")}`;
    await evaluate(`(async()=>{
    const {BrowserProjectSession}=await import('/src/modules/workspace/browser-session.ts');window.fixtureSession=new BrowserProjectSession();await fixtureSession.start();await fixtureSession.openProject(new File([${JSON.stringify(JSON.stringify(fixture))}],'fixture.tandem'));
    const file=new File([Uint8Array.from(atob(${JSON.stringify(wav.toString("base64"))}),c=>c.charCodeAt(0))],'voice.wav',{type:'audio/wav'});await fixtureSession.stageServiceResource('cli-helpers','voice',file,new AbortController().signal);
    const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;
    for(const [id,color]of [['camera','#fbb454'],['screen','#4494ee']]){const context=canvas.getContext('2d');context.fillStyle=color;context.fillRect(0,0,320,180);await fixtureSession.stageServiceResource('cli-helpers',id,new File([await new Promise(done=>canvas.toBlob(done,'image/png'))],id+'.png',{type:'image/png'}),new AbortController().signal);}
    const {audioIdentity}=await import(${JSON.stringify(fsRoot + "/packages/platform-browser/src/audio-analysis.ts")});const {TRANSCRIPT_VERSION}=await import(${JSON.stringify(fsRoot + "/packages/platform-browser/src/transcription.ts")});const {derivedCache}=await import(${JSON.stringify(fsRoot + "/packages/platform-browser/src/derived-cache.ts")});await derivedCache(TRANSCRIPT_VERSION+':'+await audioIdentity(file),{model:'fixture',language:'en',words:[{text:'Hello.',start:0.2,end:0.5},{text:'Again',start:2,end:2.3},{text:'Bye',start:4,end:4.3}]});
  })()`);
    client = new Client({ name: "Codex MCP acceptance", version: "1" });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [
          join(root, "scripts/sidecut-mcp.mjs"),
          "--endpoint-file",
          join(profile, "current.tandem.api.json"),
        ],
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: "1",
          SIDECUT_PROJECT: "",
          TANDEM_PROJECT: "",
          SIDECUT_AUTHOR: "",
          TANDEM_AUTHOR: "",
        },
        stderr: "pipe",
      }),
    );
    const successes = new Map(),
      failures = [];
    const call = async (name, args = {}, json = true) => {
      const reply = await client.callTool({ name, arguments: { ...args, json } }, undefined, {
        timeout: 120000,
      });
      assert.equal(reply.isError, false, `${name}: ${JSON.stringify(reply)}`);
      assert.ok(reply.content.length);
      const text = reply.content.find((c) => c.type === "text")?.text;
      assert.equal(typeof text, "string");
      successes.set(name, [
        ...new Set([...(successes.get(name) ?? []), json ? "json" : "readable"]),
      ]);
      return json ? JSON.parse(text) : text;
    };
    const project = () => evaluate("JSON.stringify(fixtureSession.projectFile().project)");
    const revision = async () => (await call("status")).revision;
    const fail = async (name, args) => {
      const before = await project(),
        rev = await revision();
      const reply = await client.callTool({ name, arguments: args });
      assert.equal(reply.isError, true, `${name} unexpectedly succeeded: ${JSON.stringify(reply)}`);
      assert.equal(reply.content.length, 1);
      assert.equal(reply.content[0].type, "text");
      assert.ok(!reply.content[0].text.startsWith("{"));
      assert.equal(await project(), before);
      assert.equal(await revision(), rev);
      failures.push({ name, message: reply.content[0].text });
    };
    const tools = (await client.listTools()).tools;
    assert.equal(tools.length, 43);
    for (const [name, args] of [
      ["status", {}],
      ["timeline", {}],
      ["media", {}],
      ["transcript", {}],
      ["search", { phrase: "Again" }],
      ["pauses", { min: 0.6 }],
      ["tighten", { min: 0.6, keep: 0.1 }],
      ["join", {}],
      ["captions", { words: 2 }],
      ["short", {}],
      ["cards", { markers: ["section"], sounds: false }],
      ["comments", {}],
      ["clips", { track: "Voice" }],
      ["validate", {}],
      ["check", { quick: true }],
      ["effects", {}],
      ["history", {}],
      ["watch", { timeout: 0 }],
      ["archive", { dryRun: true }],
      ["relink", { dryRun: true }],
      ["wait", { what: "export", timeout: 0 }],
      ["transcribe", { media: ["voice"], wait: true, timeout: 2 }],
      ["loudness", { mediaID: "voice" }],
    ]) {
      await call(name, args);
      await call(name, args, false);
    }
    const baseline = await project(),
      start = await revision();
    const edit = await call("apply", {
      commands: [{ updateClip: { clipID: "camera-clip", patch: { start: 0.1 } } }],
      expectedRevision: start,
      idempotencyKey: "mcp-once",
      label: "MCP move",
    });
    assert.equal(edit.author, "codex");
    const retry = await call("apply", {
      commands: [{ updateClip: { clipID: "camera-clip", patch: { start: 0.1 } } }],
      expectedRevision: start,
      idempotencyKey: "mcp-once",
      label: "MCP move",
    });
    assert.equal(retry.repeated, true);
    await call("diff", { since: String(start) });
    await call("diff", { since: String(start) }, false);
    await call("restore", { from: String(start), clips: ["camera-clip"] });
    await call("restore", { from: String(start), clips: ["camera-clip"] }, false);
    await call("restore", {
      from: String(start),
      clips: ["camera-clip"],
      apply: true,
      expectedRevision: await revision(),
    });
    await wait(async () => (await project()) === baseline);
    await call("undo", {}, false);
    await call("redo", {}, false);
    await wait(async () => (await project()) === baseline);
    const beforeSync = await project();
    await call("sync", { delay: 0.08, media: ["take"], expectedRevision: await revision() }, false);
    await call("undo");
    await wait(async () => (await project()) === beforeSync);
    for (const name of ["tighten", "join", "captions", "short", "cards"]) {
      const args = name === "cards" ? { markers: ["section"], sounds: false } : {};
      await call(name, { ...args, apply: true, expectedRevision: await revision() }, false);
      await call("undo");
      await wait(async () => (await project()) === baseline);
    }
    const frameReply = await client.callTool({
      name: "frame",
      arguments: { time: "0:01", json: true },
    });
    assert.equal(frameReply.isError, false, JSON.stringify(frameReply));
    assert.equal(frameReply.content[0].type, "image");
    assert.equal(frameReply.content[1].type, "text");
    const frameMetadata = JSON.parse(frameReply.content[1].text);
    assert.equal(frameMetadata.png, undefined);
    const frameBytes = Buffer.from(frameReply.content[0].data, "base64");
    assert.equal(frameBytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    successes.set("frame", ["json image"]);
    await call("frame", { time: 0, maxWidth: 160 }, false);
    for (const [name, args] of [
      ["frames", { times: [0, 1], width: 96 }],
      ["screenshot", { output: "mcp-editor.png" }],
      ["clip", { start: 0, end: 0.3, audioOnly: true, output: "mcp-audio.wav" }],
      ["export", { preset: "final", from: 0, to: 0.3, output: "mcp-movie.mp4" }],
    ])
      await call(name, args, false);
    await call("wait", { what: "transcript", media: ["voice"], timeout: 2 }, false);
    await evaluate(`(async()=>{
      const {AssetLibrary,normalizeAsset}=await import(${JSON.stringify(fsRoot + "/packages/platform-browser/src/asset-library.ts")});window.assetLibrary=await AssetLibrary.open();
      const {decodeAsset}=await import(${JSON.stringify(fsRoot + "/packages/contracts/src/assets.ts")});
      const canvas=document.createElement('canvas');canvas.width=64;canvas.height=32;canvas.getContext('2d').fillStyle='#ffb454';canvas.getContext('2d').fillRect(0,0,64,32);
      const png=new File([await new Promise(r=>canvas.toBlob(r,'image/png'))],'picture.png',{type:'image/png'});
      await assetLibrary.put(await normalizeAsset(png,decodeAsset({provider:'import',providerID:'picture',kind:'icon',name:'MCP picture',licenceClass:'creditNeeded',creditLine:'Fixture artist'})));
    })()`);
    await call("assets_providers", {}, false);
    await call("assets_search", { text: "picture", provider: "import", kind: "icon" }, false);
    await call("assets_show", { id: "import:picture" }, false);
    const used = await call("assets_use", {
      id: "import:picture",
      at: 0,
      duration: 1,
      expectedRevision: await revision(),
    });
    assert.equal(used.applied.author, "codex");
    await call("assets_credits", {}, false);
    const id = used.applied.createdIDs.find((created) => created.startsWith("clip_"));
    assert.ok(id);
    await call("segments_save", { name: "MCP Intro", clipIDs: [id] }, false);
    await call("segments_list", {}, false);
    const savedProject = await project();
    await call(
      "segments_insert",
      { name: "MCP Intro", at: 1, expectedRevision: await revision() },
      false,
    );
    await call("undo");
    await wait(async () => (await project()) === savedProject);
    await fail("assets_generate", { kind: "sfx", prompt: "Unconfirmed" });
    await evaluate(`(async()=>{
      const {BrowserAssetProviders}=await import(${JSON.stringify(fsRoot + "/packages/platform-browser/src/asset-providers.ts")});const {AssetProviders}=await import(${JSON.stringify(fsRoot + "/packages/assets/src/index.ts")});
      window.fixtureGenerationCalls=0;const engine=new AssetProviders({mode:'host',hasCredential:async()=>true,request:async()=>{window.fixtureGenerationCalls++;return {status:window.fixtureGenerationCalls===2?500:200,headers:{},bytes:new ArrayBuffer(48000)}}});
      const bridge={providerCall:async(_id,r)=>engine.generate('elevenlabs',r.request,r.confirmedPaid,new AbortController().signal,async()=>{}),providerCancel:async()=>{},providerCredential:async()=>{}};
      const original=BrowserAssetProviders.prototype.generate;window.restoreGeneration=()=>{BrowserAssetProviders.prototype.generate=original;};
      BrowserAssetProviders.prototype.generate=function(request,confirmedPaid,signal){return original.call(new BrowserAssetProviders(assetLibrary,undefined,bridge),request,confirmedPaid,signal);};
    })()`);
    let generated;
    try {
      generated = await call(
        "assets_generate",
        {
          kind: "sfx",
          prompt: "Fixture whoosh",
          duration: 0.5,
          variations: 2,
          confirmedPaid: true,
        },
        false,
      );
      assert.match(generated, /Made 1 sound effect/);
    } finally {
      await evaluate("restoreGeneration()");
    }
    for (const [name, args] of [
      ["status", { json: "true" }],
      ["timeline", { from: "bad" }],
      ["media", { refresh: "yes" }],
      ["transcript", { id: "missing" }],
      ["transcribe", { media: ["missing"] }],
      ["search", {}],
      ["pauses", { min: 0 }],
      ["tighten", { min: -1 }],
      ["join", { from: 8, to: 1 }],
      ["captions", { words: 0 }],
      ["short", { expectedRevision: -1, apply: true }],
      ["cards", { markers: ["missing"], sounds: false }],
      [
        "apply",
        { commands: [{ updateProject: { patch: { name: "Stale" } } }], expectedRevision: 0 },
      ],
      ["undo", { count: 0 }],
      ["redo", { count: 0 }],
      ["history", { limit: 0 }],
      ["diff", { since: "999999" }],
      ["restore", { from: "999999", clips: ["camera-clip"], apply: true }],
      ["clips", { track: "missing" }],
      ["validate", { unknown: true }],
      ["check", { from: 8, to: 1 }],
      ["sync", { delay: 2 }],
      ["comments", { unknown: true }],
      ["frame", { time: 99 }],
      ["frames", { times: [99] }],
      ["screenshot", { output: "../escape.png" }],
      ["clip", { start: 1, end: 0 }],
      ["export", { preset: "missing" }],
      ["archive", { to: join(profile, "current.tandem.api.json") }],
      ["relink", { search: ["missing"] }],
      ["loudness", { mediaID: "missing" }],
      ["watch", { timeout: "bad" }],
      ["wait", { what: "unknown" }],
      ["assets_search", { provider: "missing" }],
      ["assets_use", { id: "missing" }],
      ["assets_show", { id: "missing" }],
      ["assets_credits", { includeOptional: "yes" }],
      ["segments_list", { unknown: true }],
      ["segments_save", { name: "Bad", clipIDs: ["missing"] }],
      ["segments_insert", { name: "Missing", at: 0 }],
      ["assets_providers", { unknown: true }],
      ["effects", { type: "missing" }],
    ])
      await fail(name, args);
    const controller = new AbortController();
    const waiting = client.callTool(
      { name: "watch", arguments: { timeout: 5, revision: await revision() } },
      undefined,
      { signal: controller.signal },
    );
    controller.abort();
    await assert.rejects(waiting);
    assert.deepEqual([...successes.keys()].sort(), tools.map((t) => t.name).sort());
    assert.deepEqual(
      [...new Set(failures.map((f) => f.name))].sort(),
      tools.map((t) => t.name).sort(),
    );
    const evidence = {
      platform: process.platform,
      reference: "735a9b8e162c1f951044baa892d94993869f2e77",
      tools: tools.length,
      successes: Object.fromEntries(successes),
      failures,
      frame: { ...frameMetadata, pngSignature: true, imageFirst: true },
      author: edit.author,
      idempotentRetry: retry.repeated,
      cancellation: true,
      limits: [
        "Windows development Electron runtime",
        "Provider generation fixture only; no credentials or paid calls",
        "Cached transcript; no model download",
        "Managed exclusive outputs retained",
        "Native macOS/Linux and upstream rendered parity unverified",
      ],
    };
    await writeFile(
      join(root, "docs/verification/mcp-adapters-runtime.json"),
      JSON.stringify(evidence, null, 2) + "\n",
    );
    console.log(JSON.stringify(evidence));
  } catch (error) {
    exitCode = 1;
    console.error(error);
  } finally {
    await client?.close();
    app.once("will-quit", () => app.exit(exitCode));
    app.quit();
  }
}
void verify();
