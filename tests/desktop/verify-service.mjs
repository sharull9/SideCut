// Requires build:desktop and a dev server at http://127.0.0.1:4270.
// With ELECTRON_RUN_AS_NODE unset: vp exec --filter @sidecut/desktop electron ../../tests/desktop/verify-service.mjs
import { app, BrowserWindow, nativeImage } from "electron";
import { mkdtempSync } from "node:fs";
import { readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../.."),
  profile = mkdtempSync(join(tmpdir(), "sidecut-service-"));
app.setPath("userData", profile);
app.setAppPath(join(root, "apps/desktop"));
process.env.SIDECUT_RENDERER_URL = "http://127.0.0.1:4270";
const evidence = {};
let resultCode = 0;
const wait = async (predicate) => {
  const until = Date.now() + 30000;
  while (Date.now() < until) {
    const value = await predicate();
    if (value) return value;
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error("Service runtime timed out.");
};
async function verify() {
  try {
    await import("../../apps/desktop/dist/main.mjs");
    await app.whenReady();
    const window = await wait(() => BrowserWindow.getAllWindows()[0]),
      evaluate = (source) => window.webContents.executeJavaScript(source);
    await wait(() =>
      evaluate("Boolean(document.querySelector('[data-testid=project-name]'))").catch(() => false),
    );
    const audio = await readFile(join(root, "tests/fixtures/audio/speech.wav"));
    const fsRoot = "/@fs/" + root.replaceAll("\\", "/");
    const fixture = {
      revision: 0,
      project: {
        id: "prj_runtime_services",
        name: "Service runtime",
        settings: { width: 320, height: 180, frameRate: { numerator: 30, denominator: 1 } },
        media: [{ id: "med_voice", path: "voice.wav", kind: "audio", hasAudio: true }],
        videoTracks: [
          {
            id: "graphics",
            kind: "video",
            name: "Graphics",
            clips: [
              {
                id: "solid",
                content: { solid: { color: { r: 0.1, g: 0.4, b: 0.7, a: 1 } } },
                start: 0,
                duration: 4,
              },
            ],
          },
        ],
        audioTracks: [
          {
            id: "voice",
            kind: "audio",
            name: "Voice",
            rippleMode: "cut",
            clips: [
              {
                id: "speech_a",
                content: { media: { mediaID: "med_voice" } },
                start: 0,
                duration: 2,
                sourceStart: 0,
              },
              {
                id: "speech_b",
                content: { media: { mediaID: "med_voice" } },
                start: 2,
                duration: 2,
                sourceStart: 2,
              },
            ],
          },
        ],
        markers: [{ id: "section", name: "Next section", kind: "section", time: 3 }],
      },
    };
    await evaluate(`(async()=>{
      const {BrowserProjectSession}=await import('/src/modules/workspace/browser-session.ts');window.fixtureSession=new BrowserProjectSession();await fixtureSession.start();
      await fixtureSession.openProject(new File([${JSON.stringify(JSON.stringify(fixture))}],'services.tandem'));
      await fixtureSession.relinkMedia('med_voice',new File([new Uint8Array(${JSON.stringify([...audio])})],'voice.wav',{type:'audio/wav'}));
      const {audioIdentity}=await import(${JSON.stringify(fsRoot + "/packages/platform-browser/src/audio-analysis.ts")});
      const {TRANSCRIPT_VERSION}=await import(${JSON.stringify(fsRoot + "/packages/platform-browser/src/transcription.ts")});
      const {derivedCache}=await import(${JSON.stringify(fsRoot + "/packages/platform-browser/src/derived-cache.ts")});
      const source=await fixtureSession.resource('med_voice');
      await derivedCache(TRANSCRIPT_VERSION+':'+await audioIdentity(source.file),{model:'fixture',language:'en',words:[{text:'Hello.',start:.1,end:.4},{text:'New',start:1.5,end:1.8},{text:'world.',start:2.1,end:2.4},{text:'Next.',start:3.2,end:3.5}]});
    })()`);
    const discovery = JSON.parse(await readFile(join(profile, "current.tandem.api.json"), "utf8"));
    const call = async (operation, body = {}, expected = 200) => {
      const response = await fetch(`http://127.0.0.1:${discovery.port}/v1/${operation}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${discovery.token}`,
          "Content-Type": "application/json",
          "X-Tandem-Author": "runtime-agent",
        },
        body: JSON.stringify(body),
      });
      const value = await response.json();
      assert.equal(response.status, expected, `${operation}: ${JSON.stringify(value)}`);
      return value;
    };
    const initial = await call("status"),
      preview = await call("apply", {
        dryRun: true,
        label: "Preview",
        commands: [{ updateProject: { patch: { name: "Uncommitted" } } }],
        expectedRevision: initial.revision,
      });
    assert.equal(preview.dryRun, true);
    assert.equal((await call("status")).name, "Service runtime");
    const edit = await call("apply", {
      label: "Agent gain",
      commands: [{ updateClip: { clipID: "speech_a", patch: { audio: { gainDB: -3 } } } }],
      expectedRevision: initial.revision,
      idempotencyKey: "runtime-gain",
    });
    assert.equal(edit.author, "runtime-agent");
    assert.ok(edit.changed.includes("speech_a"));
    const repeated = await call("apply", {
      label: "Agent gain",
      commands: [{ updateClip: { clipID: "speech_a", patch: { audio: { gainDB: -3 } } } }],
      idempotencyKey: "runtime-gain",
    });
    assert.equal(repeated.repeated, true);
    await call(
      "apply",
      {
        commands: [{ updateProject: { patch: { name: "Stale" } } }],
        expectedRevision: initial.revision,
      },
      409,
    );
    const diff = await call("diff", { since: initial.revision });
    assert.ok(diff.changes.some((change) => change.id === "speech_a"));
    assert.deepEqual(diff.changes[0].details, ["gain 0 -> -3 dB"]);
    assert.ok(
      diff.edits.some((record) => record.label === "Agent gain" && record.changes.length === 1),
    );
    assert.deepEqual((await call("diff", { since: `r${initial.revision}` })).changes, diff.changes);
    const clips = await call("clips", {
      track: "A1 Voice",
      from: 2,
      to: 4,
      media: "voice.wav",
      ids: true,
    });
    assert.deepEqual(
      clips.clips.map((c) => c.id),
      ["speech_b"],
    );
    assert.equal(clips.idsOnly, true);
    await call("clips", { track: "absent" }, 404);
    await call("diff", { since: "r999999" }, 400);
    const restore = await call("restore", { from: initial.revision, clips: ["speech_a"] });
    assert.ok(restore.commands.length);
    const applied = await call("restore", {
      from: initial.revision,
      clips: ["speech_a"],
      apply: true,
      expectedRevision: edit.revision,
    });
    const undo = await call("undo", { expectedRevision: applied.applied.revision }),
      redo = await call("redo", { expectedRevision: undo.revision }),
      history = await call("history", { limit: 10 });
    evidence.history = {
      previewRevision: preview.revision,
      editRevision: edit.revision,
      repeated: repeated.repeated,
      diff: diff.changes.length,
      restored: applied.applied.revision,
      undo: undo.revision,
      redo: redo.revision,
      entries: history.edits.length,
    };
    const transcript = await call("transcript"),
      search = await call("search", { phrase: "new world" }),
      pauses = await call("pauses"),
      transcribe = await call("transcribe", { media: ["med_voice"], wait: true, timeout: 20 });
    assert.equal(transcript.words.length, 4);
    assert.ok(search.hits.length);
    assert.equal(transcribe.files[0].state, "ready");
    assert.equal(transcribe.waited.what, "transcript");
    assert.equal(transcribe.waited.done, true);
    assert.equal(transcribe.waited.timedOut, false);
    assert.equal(transcribe.waited.finished.length, 1);
    assert.deepEqual(transcribe.waited.pending, []);
    await call("transcribe", { media: ["absent"] }, 404);
    await call("apply", {
      commands: [
        {
          addMedia: {
            item: { id: "med_missing", path: "unavailable.wav", kind: "audio", hasAudio: true },
          },
        },
      ],
    });
    const failed = await call("transcribe", { media: ["med_missing"], wait: true, timeout: 5 });
    assert.equal(failed.files[0].state, "failed");
    assert.equal(failed.waited.done, true);
    assert.equal(failed.waited.pending.length, 0);
    await call("undo");
    await call("undo");
    evidence.queryHistoryFollowups = {
      clipIDs: clips.clips.map((c) => c.id),
      diffDetails: diff.changes[0].details,
      editRecords: diff.edits.length,
      transcriptWait: transcribe.waited,
      uncachedMissingSource: failed.files,
    };
    evidence.speech = {
      words: transcript.words.length,
      hits: search.hits.length,
      pauses: pauses.pauses.length,
      transcribe: transcribe.files[0].state,
    };
    evidence.helpers = {};
    for (const [operation, request] of [
      ["join", {}],
      ["captions", {}],
      ["short", {}],
      ["cards", { sounds: false }],
      ["tighten", {}],
    ]) {
      const before = (await call("status")).revision,
        plan = await call(operation, request);
      assert.equal((await call("status")).revision, before);
      if (operation === "join") {
        assert.deepEqual(plan.joins, [
          {
            time: 2,
            clips: [
              { trackID: "voice", clipID: "speech_a", nextClipID: "speech_b", track: "A1 Voice" },
            ],
          },
        ]);
        assert.deepEqual(plan.skipped, []);
      }
      if (plan.commands.length) {
        const result = await call(operation, { ...request, apply: true, expectedRevision: before });
        assert.ok(result.applied);
        await call("undo", { expectedRevision: result.applied.revision });
      }
      evidence.helpers[operation] = { commands: plan.commands.length, warnings: plan.warnings };
    }
    const silent = await call("cards", {});
    assert.ok(silent.sounds.startsWith("silent:"));
    await evaluate(`(async()=>{
      const {AssetLibrary}=await import(${JSON.stringify(fsRoot + "/packages/platform-browser/src/asset-library.ts")});
      const {decodeAsset}=await import(${JSON.stringify(fsRoot + "/packages/contracts/src/assets.ts")});
      const library=await AssetLibrary.open(),source=await fixtureSession.resource('med_voice');
      try {for(const id of ['sfx_4jhasduf','sfx_k2dvisxs']) {const asset=decodeAsset({provider:'elevenlabs',providerID:id,kind:'sfx',name:'Synthetic card test '+id,duration:4,state:'normalised',licenceClass:'noCredit'});await library.put({asset,normalised:new File([source.file],'card.wav',{type:'audio/wav'})});}} finally {library.close();}
    })()`);
    await call("apply", {
      commands: ["speech_a", "speech_b"].map((clipID) => ({
        updateClip: { clipID, patch: { audio: { normalizeTo: -28.7, gainDB: 0 } } },
      })),
    });
    const beforeCards = await call("status"),
      cardPreview = await call("cards", { insert: true });
    assert.ok(cardPreview.sounds.includes("copied"));
    assert.equal((await call("status")).revision, beforeCards.revision);
    const cardApplied = await call("cards", {
      insert: true,
      apply: true,
      expectedRevision: beforeCards.revision,
    });
    assert.equal(cardApplied.applied.revision, beforeCards.revision + 1);
    const cardCommand = cardApplied.commands.find(
      (command) => command.addSectionCards,
    ).addSectionCards;
    assert.equal(cardCommand.soundIn.gainDB, -14.1);
    assert.equal(cardCommand.soundOut.gainDB, -17);

    const cardMedia = await call("media"),
      cardClips = await call("clips");
    const soundIDs = cardApplied.commands.flatMap((command) =>
      command.addMedia ? [command.addMedia.item.id] : [],
    );
    assert.equal(soundIDs.length, 2);
    assert.equal(cardMedia.items.filter((item) => soundIDs.includes(item.id)).length, 2);
    const soundClips = cardClips.clips.filter((c) => c.mediaID && soundIDs.includes(c.mediaID));
    assert.equal(soundClips.length, 2);
    const againCards = await call("cards", { apply: true });
    assert.ok(againCards.sounds.includes("keep their sounds"));
    await call("undo");
    await call("undo");
    await call("undo");
    evidence.sectionCards = {
      previewSounds: cardPreview.sounds,
      appliedSounds: cardApplied.sounds,
      soundClips: soundClips.length,
      gains: [cardCommand.soundIn.gainDB, cardCommand.soundOut.gainDB],
      oneUndoStep: true,
      cards: cardPreview.cards,
      warnings: cardPreview.warnings,
    };
    const frame = await call("frame", { time: 0.1, maxWidth: 160, maxHeight: 100 }),
      sheet = await call("frames", { times: [0.1, 2.1], width: 160 }),
      capture = await call("screenshot");
    const frameSize = nativeImage.createFromBuffer(Buffer.from(frame.png, "base64")).getSize(),
      sheetSize = nativeImage.createFromBuffer(Buffer.from(sheet.png, "base64")).getSize(),
      screenSize = nativeImage.createFromBuffer(Buffer.from(capture.png, "base64")).getSize();
    assert.deepEqual(frameSize, { width: 160, height: 90 });
    const pixel = nativeImage.createFromBuffer(Buffer.from(frame.png, "base64")).toBitmap();
    assert.ok(
      pixel[0] > pixel[2] && pixel[1] > 50,
      "The synthetic frame must contain the blue solid.",
    );
    assert.equal(sheetSize.width, 344);
    assert.ok(screenSize.width > frameSize.width);
    const savedFrame = await call("frame", {
      time: 0.1,
      maxWidth: 160,
      output: "exports/frame.png",
    });
    assert.ok((await readFile(savedFrame.path)).length);
    await call("frame", { time: 10 }, 400);
    await call("frames", { times: [0.1], width: 10 }, 400);
    await call("screenshot", { output: "../outside.png" }, 400);
    evidence.images = {
      frame: frameSize,
      sheet: sheetSize,
      screenshot: screenSize,
      frameBytes: frame.bytes,
      pixelBGRA: [...pixel.subarray(0, 4)],
      screenshotBytes: capture.bytes,
    };
    const clip = await call("clip", {
      start: 0.1,
      end: 0.3,
      preset: "review",
      output: "exports/review.mp4",
    });
    const audioOnly = await call("clip", {
      start: 0.1,
      end: 0.3,
      audioOnly: true,
      tracks: ["A1"],
      output: "exports/stem.wav",
    });
    const exported = await call("export", {
      from: 0,
      to: 0.2,
      preset: "webm",
      output: "exports/full.webm",
    });
    const fourK = await call("export", {
      preset: "youtube4k",
      to: 1 / 30,
      output: "exports/4k.mp4",
    });
    assert.equal(fourK.codec, "hevc");
    await call("export", { preset: "unknown", to: 0.1 }, 404);
    const gainRevision = (await call("status")).revision;
    await call("apply", {
      commands: [
        {
          updateClip: {
            clipID: "speech_a",
            patch: {
              audio: { gainDB: 6 },
              keyframes: {
                "audio.gainDB": [
                  { time: 0, value: 0 },
                  { time: 1, value: 6 },
                ],
              },
            },
          },
        },
      ],
    });
    const gainFollow = await call("loudness", {
      from: 0.1,
      to: 1.8,
      gains: true,
      step: 0.5,
      tracks: ["A1"],
    });
    assert.equal(gainFollow.gains.length, 1);
    assert.ok(gainFollow.gains[0].compared > 1);
    assert.ok(gainFollow.gains[0].worstDB < 1, JSON.stringify(gainFollow.gains));
    await call("undo");
    assert.equal((await call("status")).revision, gainRevision + 2);
    const validated = await call("validate");
    assert.equal(validated.ok, true);
    const scanned = await call("check", { from: 0, to: 0.2, width: 160 });
    assert.equal(scanned.frames, 6);
    assert.deepEqual(scanned.problems, []);
    const cuts = await call("check", { cuts: true, from: 0, to: 4 });
    assert.ok(cuts.cuts >= 2);
    assert.equal(cuts.frames, 0);
    await call("check", { quick: true, cuts: true }, 400);
    await call("check", { width: 10 }, 400);
    const changed = await call("check", { changed: true, quick: true });
    assert.ok(changed.ranges.length);
    const scanRevision = (await call("status")).revision;
    await call("apply", {
      commands: [
        {
          updateClip: {
            clipID: "solid",
            patch: { content: { solid: { color: { r: 0, g: 1, b: 0, a: 1 } } } },
          },
        },
      ],
    });
    const greenScan = await call("check", { from: 0, to: 0.1, width: 160 });
    assert.ok(greenScan.problems.some((p) => p.kind === "unkeyed"));
    await call("undo");
    const cancellation = await evaluate(
      `(async()=>{const {checkService}=await import('/src/modules/workspace/service-check.ts');const controller=new AbortController();setTimeout(()=>controller.abort(),20);try{await checkService(fixtureSession,{width:384},[{start:0,end:4}],controller.signal);return false;}catch(error){return error.name==='AbortError';}})()`,
    );
    assert.equal(cancellation, true);
    assert.equal((await call("status")).revision, scanRevision + 2);
    evidence.renderReview = {
      scanCancellation: true,
      greenProblems: greenScan.problems.map((p) => p.kind),
      gainFollow: gainFollow.gains,
      validate: validated.ok,
      frames: scanned.frames,
      scanWarnings: scanned.warnings,
      cutEdges: cuts.cuts,
      cutProblems: cuts.problems.length,
      changedRanges: changed.ranges,
    };
    const deadAir = await call("check", { from: 0, to: 4, width: 160 });
    assert.ok(
      deadAir.notes.some((note) => note.kind === "deadAir"),
      JSON.stringify(deadAir.notes),
    );
    const screenFile = join(profile, "moving-screen.webm"),
      screenMade = spawnSync(
        join(root, "apps/desktop/node_modules/ffmpeg-static/ffmpeg.exe"),
        [
          "-nostdin",
          "-v",
          "error",
          "-f",
          "lavfi",
          "-i",
          "testsrc2=size=160x90:rate=5:duration=3",
          "-an",
          "-c:v",
          "libvpx",
          "-y",
          screenFile,
        ],
        { encoding: "utf8", windowsHide: true },
      );
    assert.equal(screenMade.status, 0, screenMade.stderr);
    const screenBytes = await readFile(screenFile);
    await call("apply", {
      commands: [
        {
          addMedia: {
            item: {
              id: "screen-rate",
              path: "moving-screen.webm",
              kind: "video",
              role: "screen",
              hasVideo: true,
              width: 160,
              height: 90,
              duration: 3,
            },
          },
        },
        { addTrack: { id: "screen-track", name: "Screen", kind: "video" } },
        {
          insertClip: {
            trackID: "screen-track",
            clip: { id: "screen-cut", content: { media: { mediaID: "screen-rate" } }, duration: 3 },
          },
        },
      ],
    });
    await evaluate(
      `fixtureSession.relinkMedia('screen-rate',new File([new Uint8Array(${JSON.stringify([...screenBytes])})],'moving-screen.webm',{type:'video/webm'}))`,
    );
    const screenScan = await call("check", { from: 0, to: 3, width: 160 });
    assert.ok(
      screenScan.notes.some((note) => note.kind === "lowFrameRate"),
      JSON.stringify(screenScan.notes),
    );
    await call("undo");
    await call("undo");
    evidence.renderReview.advanced = {
      deadAir: deadAir.notes.filter((note) => note.kind === "deadAir"),
      lowFrameRate: screenScan.notes.filter((note) => note.kind === "lowFrameRate"),
      warnings: screenScan.warnings,
    };
    const ffprobe = join(
      root,
      "apps/desktop/node_modules/ffprobe-static/bin/win32/x64/ffprobe.exe",
    );
    const probe = (path) => {
      const result = spawnSync(
        ffprobe,
        ["-v", "error", "-show_streams", "-show_format", "-of", "json", path],
        { encoding: "utf8", windowsHide: true },
      );
      assert.equal(result.status, 0, result.stderr);
      return JSON.parse(result.stdout);
    };
    const videoProbe = probe(clip.path),
      audioProbe = probe(audioOnly.path),
      webmProbe = probe(exported.path);
    const fourKProbe = probe(fourK.path);
    assert.equal(fourKProbe.streams[0].codec_name, "hevc");
    assert.equal(fourKProbe.streams[0].width, 3840);
    assert.equal(fourKProbe.streams[0].height, 2160);
    evidence.renderReview.fourK = {
      codec: fourKProbe.streams[0].codec_name,
      width: fourKProbe.streams[0].width,
      height: fourKProbe.streams[0].height,
      bytes: fourK.bytes,
    };
    assert.equal(videoProbe.streams[0].codec_name, "h264");
    assert.equal(videoProbe.streams[0].height, 720);
    const videoPixel = spawnSync(
      join(root, "apps/desktop/node_modules/ffmpeg-static/ffmpeg.exe"),
      [
        "-v",
        "error",
        "-i",
        clip.path,
        "-frames:v",
        "1",
        "-vf",
        "scale=1:1",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        "pipe:1",
      ],
      { windowsHide: true },
    );
    assert.equal(videoPixel.status, 0);
    assert.ok(
      videoPixel.stdout[2] > videoPixel.stdout[0] && videoPixel.stdout[1] > 50,
      "The encoded video must preserve the blue picture.",
    );
    assert.equal(audioProbe.streams.length, 1);
    assert.equal(audioProbe.streams[0].codec_name, "pcm_s16le");
    assert.ok(
      Math.abs(Number(audioProbe.format.duration) - 0.2) < 0.001,
      JSON.stringify(audioProbe.format),
    );
    assert.equal(webmProbe.streams[0].codec_name, "vp8");
    const aac = await call("clip", {
      start: 0.1,
      end: 0.3,
      audioOnly: true,
      output: "exports/audio.m4a",
    });
    const aacProbe = probe(aac.path);
    assert.equal(aacProbe.streams[0].codec_name, "aac");
    const portraitPlan = await call("short", { apply: true });
    const portrait = await call("export", {
      preset: "short",
      to: 0.1,
      output: "exports/portrait.mp4",
    });
    const portraitProbe = probe(portrait.path);
    assert.equal(portraitProbe.streams[0].width, 1080);
    assert.equal(portraitProbe.streams[0].height, 1920);
    await call("undo", { expectedRevision: portraitPlan.applied.revision });
    const exportDiff = await call("diff", { since: "exports/full.webm" });
    assert.deepEqual(exportDiff.changes, []);
    const sourceLevels = await call("loudness", { mediaID: "med_voice" }),
      mix = await call("loudness", { from: 0, to: 2, step: 1, over: -1 });
    assert.equal(sourceLevels.media[0].state, "ready");
    assert.ok(mix.curve.points.length >= 2);
    evidence.render = {
      clip: {
        bytes: clip.bytes,
        width: videoProbe.streams[0].width,
        height: videoProbe.streams[0].height,
        duration: Number(videoProbe.format.duration),
        pixelRGB: [...videoPixel.stdout.subarray(0, 3)],
      },
      audioOnly: { bytes: audioOnly.bytes, codec: audioProbe.streams[0].codec_name },
      export: { bytes: exported.bytes, codec: webmProbe.streams[0].codec_name },
      aac: { bytes: aac.bytes, codec: aacProbe.streams[0].codec_name },
      portrait: { width: portraitProbe.streams[0].width, height: portraitProbe.streams[0].height },
      loudness: { source: sourceLevels.media[0].integratedLUFS, points: mix.curve.points.length },
    };
    if (process.argv.includes("--model")) {
      console.log("Verifying uncached local speech model acquisition and transcription");
      const uncached = new Uint8Array(audio);
      uncached[uncached.length - 1] ^= 1;
      await call("apply", {
        commands: [
          {
            addMedia: {
              item: { id: "model_probe", path: "model-probe.wav", kind: "audio", hasAudio: true },
            },
          },
        ],
      });
      await evaluate(
        `fixtureSession.relinkMedia('model_probe',new File([new Uint8Array(${JSON.stringify([...uncached])})],'model-probe.wav',{type:'audio/wav'}))`,
      );
      const queued = await call("transcribe", { media: ["model_probe"], wait: true, timeout: 0 });
      assert.equal(queued.waited.timedOut, true);
      const made = await call("transcribe", { media: ["model_probe"], wait: true, timeout: 60 });
      evidence.firstRunModel = { queued: queued.waited, result: made };
      await writeFile(
        join(root, "docs/verification/transcribe-model-runtime.json"),
        JSON.stringify(evidence.firstRunModel, null, 2) + "\n",
      );
      assert.equal(made.files[0].state, "ready", JSON.stringify(made));
    }
    await writeFile(
      join(root, "docs/verification/render-review-runtime.json"),
      JSON.stringify(evidence, null, 2) + "\n",
    );
    await window.webContents
      .capturePage()
      .then((image) =>
        writeFile(join(root, "docs/verification/render-review-editor.png"), image.toPNG()),
      );
    console.log(JSON.stringify(evidence));
    await evaluate("fixtureSession.close()");
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
