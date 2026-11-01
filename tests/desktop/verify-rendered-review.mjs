import { app, BrowserWindow } from "electron";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve, isAbsolute } from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const root = resolve(import.meta.dirname, "../..");
const profile = process.env.SIDECUT_RENDERED_REVIEW_PROFILE;
assert.ok(profile && isAbsolute(profile));
app.setPath("userData", profile);
app.setAppPath(join(root, "apps/desktop"));
delete process.env.SIDECUT_RENDERER_URL;
const restart = process.env.SIDECUT_REVIEW_RESTART === "1";
const statePath = join(profile, "review-fixture-state.json");
const report = restart
  ? JSON.parse(await readFile(statePath, "utf8"))
  : {
      testedAt: new Date().toISOString(),
      platform: process.platform,
      production: true,
      syntheticInputs: true,
      physicalCapture: false,
      accepted: false,
      checks: Object.fromEntries(
        [
          "revisionA",
          "export",
          "publication",
          "playback",
          "comments",
          "revisionB",
          "isolation",
          "restart",
        ].map((name) => [name, { status: "notrun" }]),
      ),
      errors: [],
    };
let stage = "launch";
const reportPath = join(root, "docs/verification/lawn-videorc-rendered-review.json");
async function until(fn, label, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value) return value;
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error("Timed out: " + label);
}
async function verify() {
  try {
    await import("../../apps/desktop/dist/main.mjs");
    await app.whenReady();
    const window = await until(() => BrowserWindow.getAllWindows()[0], "window");
    window.setContentSize(1440, 960);
    window.show();
    window.webContents.setBackgroundThrottling(false);
    const evaluate = (script) => window.webContents.executeJavaScript(script, true);
    await until(
      () =>
        evaluate(
          "Boolean(document.querySelector('.editor-workspace') && window.sidecutDesktop)",
        ).catch(() => false),
      "editor",
    );
    const section =
      "[...document.querySelectorAll('details')].find(d => d.querySelector('summary')?.textContent.includes('Review versions'))";
    const button = (label, scope = "document") =>
      `[...(${scope}).querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(label)})`;
    const rows = async (collection) =>
      evaluate(
        `window.sidecutDesktop.storageRequest({type:'read',collection:${JSON.stringify(collection)}}).then(rows => rows.map(row => JSON.parse(row.value)))`,
      );
    const setInput = async (selector, value) =>
      evaluate(
        `(() => { const e=document.querySelector(${JSON.stringify(selector)}); if(!e) throw Error('Missing input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)}); e.dispatchEvent(new Event('input',{bubbles:true})); })()`,
      );
    const click = async (label, scope = section) =>
      evaluate(
        `(() => { const b=${button(label, scope)}; if(!b || b.disabled) throw Error('Button unavailable: ${label}'); b.click(); })()`,
      );
    const openReview = async () => {
      await until(() => evaluate(`Boolean(${section})`), "review workspace");
      await evaluate(`${section}.open=true`);
    };
    const digest = async (version) => {
      const bytes = await evaluate(
        `window.sidecutDesktop.storageGetFile(${JSON.stringify(version.artifact.fileID)})`,
      );
      const data = Buffer.from(Object.values(bytes));
      assert.equal(data.length, version.artifact.bytes);
      return createHash("sha256").update(data).digest("hex");
    };
    const selectVersion = async (id) =>
      evaluate(
        `(() => { const e=document.querySelector('#review-version'); e.value=${JSON.stringify(id)}; e.dispatchEvent(new Event('change',{bubbles:true})); })()`,
      );
    const playback = async () => {
      await until(
        () => evaluate(`Boolean((${section}).querySelector('video')?.readyState >= 2)`),
        "decoded review video",
      );
      const result = await evaluate(
        `(async () => { const v=(${section}).querySelector('video'); v.currentTime=0; await v.play(); await new Promise((resolve,reject) => { const timer=setTimeout(()=>reject(Error('Playback did not advance')),5000); const tick=()=>{if(v.currentTime>0.1 && v.getVideoPlaybackQuality().totalVideoFrames>0){clearTimeout(timer); v.removeEventListener('timeupdate',tick); resolve();}}; v.addEventListener('timeupdate',tick); }); v.pause(); return {time:v.currentTime, frames:v.getVideoPlaybackQuality().totalVideoFrames, width:v.videoWidth, height:v.videoHeight}; })()`,
      );
      assert.ok(result.width && result.height && result.frames > 0 && result.time > 0.1);
      return result;
    };
    if (restart) {
      stage = "restart";
      await openReview();
      const versions = await rows("reviewVersions"),
        threads = await rows("reviewThreads");
      assert.deepEqual(
        versions.sort((a, b) => a.id.localeCompare(b.id)),
        report.saved.versions.sort((a, b) => a.id.localeCompare(b.id)),
      );
      assert.deepEqual(
        threads.sort((a, b) => a.id.localeCompare(b.id)),
        report.saved.threads.sort((a, b) => a.id.localeCompare(b.id)),
      );
      for (const version of versions)
        assert.equal(await digest(version), report.saved.digests[version.id]);
      await selectVersion(report.saved.aID);
      await until(
        () =>
          evaluate(
            `(${section}).textContent.includes('Point A') && (${section}).textContent.includes('Range A')`,
          ),
        "persisted A comments",
      );
      const decoded = await playback();
      await selectVersion(report.saved.bID);
      await until(
        () =>
          evaluate(
            `(${section}).textContent.includes('Point B') && !(${section}).textContent.includes('Point A')`,
          ),
        "persisted B isolation",
      );
      report.checks.restart = {
        status: "pass",
        decoded,
        versionCount: versions.length,
        threadCount: threads.length,
      };
      delete report.saved;
      report.accepted = Object.values(report.checks).every((check) => check.status === "pass");
      return;
    }
    const discovery = JSON.parse(await readFile(join(profile, "current.tandem.api.json"), "utf8"));
    const call = async (operation, input = {}) => {
      const response = await fetch("http://127.0.0.1:" + discovery.port + "/v1/" + operation, {
        method: "POST",
        headers: { authorization: "Bearer " + discovery.token, "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      const result = await response.json();
      assert.equal(response.status, 200, JSON.stringify(result));
      return result;
    };
    const original = (await call("timeline", { format: "json" })).project;
    stage = "revision A";
    await call("apply", {
      label: "Review fixture A",
      commands: [
        ...[...original.videoTracks, ...original.audioTracks].map((track) => ({
          removeTrack: { trackID: track.id },
        })),
        {
          updateSettings: {
            patch: { width: 320, height: 180, frameRate: { numerator: 30000, denominator: 1001 } },
          },
        },
        { addTrack: { id: "review-picture", name: "Picture", kind: "video" } },
        { addTrack: { id: "review-range", name: "Range selection", kind: "video" } },
        {
          insertClip: {
            trackID: "review-picture",
            clip: {
              id: "review-red",
              start: 0,
              duration: 3,
              content: { solid: { color: { r: 0.8, g: 0.1, b: 0.1, a: 1 } } },
            },
          },
        },
        {
          insertClip: {
            trackID: "review-picture",
            clip: {
              id: "review-blue",
              start: 3,
              duration: 3,
              content: { solid: { color: { r: 0.1, g: 0.1, b: 0.8, a: 1 } } },
            },
          },
        },
      ],
    });
    const revisionA = (await call("status")).revision;
    const before = (await call("timeline", { format: "json" })).project;
    assert.deepEqual(before.settings.frameRate, { numerator: 30000, denominator: 1001 });
    await until(
      () =>
        evaluate(
          "Boolean(document.querySelector('[data-clip-id=review-red]') && document.querySelector('[data-track-id=review-range].editor-track-lane'))",
        ),
      "fixture timeline",
    );
    report.checks.revisionA = {
      status: "pass",
      revision: revisionA,
      frameRate: before.settings.frameRate,
      projectID: before.id,
    };
    stage = "range selection";
    const geometry = await evaluate(
      "(() => { const lane = document.querySelector('[data-track-id=review-range].editor-track-lane').getBoundingClientRect(); const clip = document.querySelector('[data-clip-id=review-red]').getBoundingClientRect(); return {x: lane.left, y: lane.top + lane.height / 2, pixelsPerSecond: clip.width / 3}; })()",
    );
    assert.ok(geometry.pixelsPerSecond > 0);
    const mouse = (type, x, modifiers = []) =>
      window.webContents.sendInputEvent({
        type,
        x: Math.round(x),
        y: Math.round(geometry.y),
        button: "left",
        clickCount: 1,
        modifiers,
      });
    const start = geometry.x + geometry.pixelsPerSecond,
      end = geometry.x + geometry.pixelsPerSecond * 2.5;
    mouse("mouseMove", start);
    mouse("mouseDown", start, ["shift"]);
    mouse("mouseMove", end, ["shift", "leftButtonDown"]);
    mouse("mouseUp", end, ["shift"]);
    await evaluate(button("Export") + ".click()");
    await until(
      () => evaluate("Boolean(document.querySelector('[aria-label=\"Export range\"]'))"),
      "export dialog",
    );
    const range = await evaluate(
      "(() => { const s = document.querySelector('[aria-label=\"Export range\"]'); const option = s.querySelector('option[value=range]'); if (!option || option.disabled) return null; s.value='range'; s.dispatchEvent(new Event('change',{bubbles:true})); return option.textContent; })()",
    );
    assert.ok(range, "Timeline range was not selected by shift-drag");
    await evaluate(button("Queue export") + ".click()");
    // Edit after queuing: the exported snapshot must remain revision A.
    await call("apply", {
      label: "Review fixture B",
      commands: [
        {
          insertClip: {
            trackID: "review-range",
            clip: {
              id: "review-green",
              start: 0,
              duration: 3,
              content: { solid: { color: { r: 0.1, g: 0.8, b: 0.1, a: 1 } } },
            },
          },
        },
      ],
    });
    const revisionB = (await call("status")).revision;
    assert.ok(revisionB > revisionA);
    stage = "render export";
    await until(
      async () => {
        const result = await evaluate(
          "(() => { const list=document.querySelector('[aria-label=\"Export queue\"]'); return { text:list?.textContent, done:Boolean(list?.querySelector('a[download]')) }; })()",
        );
        if (/failed/i.test(result.text ?? "")) throw new Error(result.text);
        return result.done;
      },
      "completed WebM export",
      90000,
    );
    report.checks.export = { status: "pass", rangeLabel: range };
    await evaluate(
      "document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))",
    );
    stage = "publication";
    await openReview();
    await setInput("#review-author", "Reviewer");
    await setInput("#review-title", "Revision A");
    await click("Save review version");
    const a = await until(
      async () => (await rows("reviewVersions")).find((v) => v.title === "Revision A"),
      "version A",
    );
    assert.equal(a.sourceRevision, revisionA);
    assert.deepEqual(JSON.parse(a.source.snapshotJSON).project.settings.frameRate, {
      numerator: 30000,
      denominator: 1001,
    });
    assert.ok(
      a.source.startSeconds > 0 &&
        a.source.durationSeconds > 0 &&
        a.source.startSeconds + a.source.durationSeconds < 6,
    );
    const aDigest = await digest(a);
    report.checks.publication = {
      status: "pass",
      versionID: a.id,
      sourceRevision: a.sourceRevision,
      source: { startSeconds: a.source.startSeconds, durationSeconds: a.source.durationSeconds },
      bytes: a.artifact.bytes,
      sha256: aDigest,
    };
    stage = "playback";
    report.checks.playback = { status: "pass", ...(await playback()) };
    stage = "comments";
    const seek = async (time) => {
      await evaluate(
        `(() => { const v=(${section}).querySelector('video'); v.currentTime=${time}; v.dispatchEvent(new Event('timeupdate')); })()`,
      );
    };
    await seek(0.2);
    await setInput("#review-body", "Point A");
    await click("Add comment at current time");
    const point = await until(
      async () => (await rows("reviewThreads")).find((t) => t.body === "Point A"),
      "point comment",
    );
    await until(
      () => evaluate(`Boolean((${section}).querySelector('#review-reply-${point.id}'))`),
      "point UI",
    );
    await setInput(`#review-reply-${point.id}`, "Reply A");
    const pointRow = `(${section}).querySelector('#review-reply-${point.id}').closest('li')`;
    await click("Reply", pointRow);
    await until(
      async () =>
        (await rows("reviewThreads")).find((t) => t.id === point.id)?.replies.length === 1,
      "reply",
    );
    await until(() => evaluate(`!${button("Resolve", pointRow)}?.disabled`), "resolve enabled");
    await click("Resolve", pointRow);
    await until(
      async () => (await rows("reviewThreads")).find((t) => t.id === point.id)?.resolvedAt,
      "resolution",
    );
    await evaluate(
      `(() => { const e=(${section}).querySelector('#review-status-filter'); e.value='all'; e.dispatchEvent(new Event('change',{bubbles:true})); })()`,
    );
    await until(() => evaluate(`Boolean(${button("Reopen", pointRow)})`), "resolved UI");
    await click("Reopen", pointRow);
    await until(async () => {
      const t = (await rows("reviewThreads")).find((item) => item.id === point.id);
      return t?.revision === 3 && !t.resolvedAt;
    }, "reopen");
    await until(
      () => evaluate(`Boolean((${section}).querySelector('video'))`),
      "video after refresh",
    );
    await seek(0.4);
    await setInput("#review-duration", "0.3");
    await setInput("#review-body", "Range A");
    await click("Add comment at current time");
    const rangeThread = await until(
      async () => (await rows("reviewThreads")).find((t) => t.body === "Range A"),
      "range comment",
    );
    assert.equal(point.anchor.durationSeconds, 0);
    assert.equal(rangeThread.anchor.durationSeconds, 0.3);
    for (const t of [point, rangeThread])
      assert.ok(
        Math.abs(
          t.anchor.sourceStartSeconds - (a.source.startSeconds + t.anchor.versionStartSeconds),
        ) < 1e-9,
      );
    report.checks.comments = {
      status: "pass",
      point: point.anchor,
      range: rangeThread.anchor,
      reply: "Reply A",
      resolvedAndReopened: true,
    };
    stage = "revisionB";
    await evaluate(button("Export") + ".click()");
    await until(
      () => evaluate("Boolean(document.querySelector('[aria-label=\"Export range\"]'))"),
      "second export dialog",
    );
    await evaluate(`(() => {
      const encoding = document.querySelector('[aria-label="Video encoding"]');
      if (!encoding) throw Error('Native video encoding control is missing');
      encoding.value = 'h264'; encoding.dispatchEvent(new Event('change', {bubbles:true}));
    })()`);
    await evaluate(button("Queue export") + ".click()");
    await until(
      async () => {
        const state = await evaluate(
          "(() => { const q=document.querySelector('[aria-label=\"Export queue\"]'); return {done:q?.querySelectorAll('a[download]').length, text:q?.textContent}; })()",
        );
        if (/failed/i.test(state.text ?? "")) throw Error(state.text);
        return state.done >= 2;
      },
      "B export",
      90000,
    );
    await evaluate(
      "document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))",
    );
    await openReview();
    await setInput("#review-title", "Revision B");
    await until(
      () =>
        evaluate(
          `(${section}).querySelectorAll('button').length > 0 && [...(${section}).querySelectorAll('button')].filter(b=>b.textContent.trim()==='Save review version').length >= 2`,
        ),
      "B export in review",
    );
    await evaluate(
      `[...(${section}).querySelectorAll('button')].filter(b=>b.textContent.trim()==='Save review version').at(-1).click()`,
    );
    const b = await until(
      async () => (await rows("reviewVersions")).find((v) => v.title === "Revision B"),
      "version B",
    );
    assert.equal(b.sourceRevision, revisionB);
    assert.equal(b.artifact.type, "video/mp4");
    assert.notEqual(a.id, b.id);
    const bDigest = await digest(b);
    assert.notEqual(aDigest, bDigest);
    report.checks.revisionB = {
      status: "pass",
      versionID: b.id,
      sourceRevision: b.sourceRevision,
      sha256: bDigest,
    };
    stage = "isolation";
    await selectVersion(b.id);
    await until(
      () => evaluate(`Boolean((${section}).querySelector('video')?.readyState >= 2)`),
      "B video",
    );
    const nativePlayback = await playback();
    report.checks.revisionB.nativePlayback = nativePlayback;
    assert.ok(!(await evaluate(`(${section}).textContent.includes('Point A')`)));
    await setInput("#review-duration", "0");
    await setInput("#review-body", "Point B");
    await click("Add comment at current time");
    await until(
      async () =>
        (await rows("reviewThreads")).find((t) => t.body === "Point B" && t.versionID === b.id),
      "B comment",
    );
    await selectVersion(a.id);
    await until(
      () =>
        evaluate(
          `(${section}).textContent.includes('Point A') && !(${section}).textContent.includes('Point B')`,
        ),
      "A isolation",
    );
    assert.deepEqual(
      (await rows("reviewVersions")).find((v) => v.id === a.id),
      a,
    );
    assert.equal(await digest(a), aDigest);
    report.checks.isolation = { status: "pass", immutableA: true, distinctThreads: true };
    await evaluate("window.sidecutDesktop.projectFlush()");
    report.saved = {
      versions: await rows("reviewVersions"),
      threads: await rows("reviewThreads"),
      digests: { [a.id]: aDigest, [b.id]: bDigest },
      aID: a.id,
      bID: b.id,
    };
    await writeFile(statePath, JSON.stringify(report));
  } catch (error) {
    if (report.checks[stage]) report.checks[stage] = { status: "fail" };
    report.errors.push({ stage, error: error.stack ?? String(error) });
  } finally {
    await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify(report));
    process.exitCode = report.errors.length ? 1 : 0;
    for (const window of BrowserWindow.getAllWindows())
      window.webContents.on("will-prevent-unload", (event) => event.preventDefault());
    app.quit();
  }
}
void verify();
