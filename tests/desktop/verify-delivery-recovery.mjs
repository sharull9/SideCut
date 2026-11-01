import { app, BrowserWindow } from "electron";
import { readFile, writeFile, readdir, stat } from "node:fs/promises";
import filesystem from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { join, resolve, isAbsolute } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import assert from "node:assert/strict";

const root = resolve(import.meta.dirname, "../..");
const profile = process.env.SIDECUT_RECOVERY_PROFILE;
assert.ok(profile && isAbsolute(profile));
app.setPath("userData", profile);
app.setAppPath(join(root, "apps/desktop"));
delete process.env.SIDECUT_RENDERER_URL;
const phase = Number(process.env.SIDECUT_RECOVERY_PHASE ?? 0);
const restart = phase > 0;
const statePath = join(profile, "recovery-fixture.json");
const reportPath = join(root, "docs/verification/lawn-videorc-delivery-recovery.json");
const report = restart
  ? JSON.parse(await readFile(statePath, "utf8"))
  : {
      testedAt: new Date().toISOString(),
      production: true,
      syntheticInputs: true,
      physicalCapture: false,
      accepted: false,
      checks: {
        rendering: { status: "notrun" },
        nativeEncoding: {
          status: "notrun",
          reason: "Native encoding interruption was not exercised.",
        },
        publication: {
          status: "notrun",
          reason:
            "The verified-to-published transition has no robust externally observable interruption point without modifying production behavior.",
        },
      },
      errors: [],
    };
async function until(fn, label, timeout = 30000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await fn();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw Error("Timed out: " + label);
}
let stage = "launch";
if (phase === 2) {
  const originalLink = filesystem.link;
  filesystem.link = async (source, destination) => {
    if (
      typeof source === "string" &&
      source.startsWith(join(profile, "storage-files")) &&
      source.endsWith(".partial")
    ) {
      const outputID = source
        .slice(source.lastIndexOf("\\") + 1)
        .split("/")
        .at(-1)
        .replace(/\.partial$/, "");
      const journal = JSON.parse(
        await readFile(join(profile, "delivery-journal", outputID + ".json"), "utf8"),
      );
      assert.equal(journal.state, "verified");
      const bytes = await readFile(source);
      assert.equal(bytes.length, journal.result.bytes);
      report.savedPublication = {
        journal,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        bytes: bytes.length,
      };
      await writeFile(statePath, JSON.stringify(report));
      console.log("PUBLICATION_INTERRUPT_READY");
      // Deterministic fixture-only barrier; the runner kills the real process before publication.
      await new Promise(() => {});
    }
    return originalLink(source, destination);
  };
  syncBuiltinESMExports();
}
async function verify() {
  try {
    await import("../../apps/desktop/dist/main.mjs");
    await app.whenReady();
    const window = await until(() => BrowserWindow.getAllWindows()[0], "window");
    window.setContentSize(1440, 960);
    window.show();
    window.webContents.setBackgroundThrottling(false);
    const evalJS = async (code) => {
      try {
        return await window.webContents.executeJavaScript(code, true);
      } catch (error) {
        throw new Error(`Renderer evaluation failed: ${code.slice(0, 500)}`, { cause: error });
      }
    };
    await until(
      () =>
        evalJS(
          "Boolean(document.querySelector('.editor-workspace') && window.sidecutDesktop)",
        ).catch(() => false),
      "editor",
    );
    const rows = () =>
      evalJS(
        "window.sidecutDesktop.storageRequest({type:'read',collection:'deliveries'}).then(rows=>rows.map(r=>JSON.parse(r.value)))",
      );
    const button = (label) =>
      `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)})`;
    const click = async (label) => {
      await until(
        () => evalJS(`Boolean(${button(label)} && !${button(label)}.disabled)`),
        `enabled ${label} control`,
      );
      return evalJS(
        `(() => { const b=${button(label)}; if(!b || b.disabled) throw Error('Unavailable: ${label}'); b.click(); })()`,
      );
    };
    stage = "rendering";
    if (!restart) {
      const discovery = JSON.parse(
        await readFile(join(profile, "current.tandem.api.json"), "utf8"),
      );
      const call = async (operation, input = {}) => {
        const response = await fetch(`http://127.0.0.1:${discovery.port}/v1/${operation}`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${discovery.token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(input),
        });
        const data = await response.json();
        assert.equal(response.status, 200, JSON.stringify(data));
        return data;
      };
      const original = (await call("timeline", { format: "json" })).project;
      await call("apply", {
        label: "Recovery frozen project",
        commands: [
          ...[...original.videoTracks, ...original.audioTracks].map((t) => ({
            removeTrack: { trackID: t.id },
          })),
          {
            updateSettings: {
              patch: { width: 640, height: 360, frameRate: { numerator: 30, denominator: 1 } },
            },
          },
          { addTrack: { id: "recovery-track", name: "Recovery", kind: "video" } },
          {
            insertClip: {
              trackID: "recovery-track",
              clip: {
                id: "recovery-solid",
                start: 0,
                duration: 30,
                content: { solid: { color: { r: 0.8, g: 0.1, b: 0.1, a: 1 } } },
              },
            },
          },
        ],
      });
      const revision = (await call("status")).revision;
      await click("Export");
      await until(
        () => evalJS("Boolean(document.querySelector('[aria-label=\"Export range\"]'))"),
        "export dialog",
      );
      await click("Queue export");
      const entry = await until(
        async () => (await rows()).find((r) => r.status === "running"),
        "durable running export",
        30000,
      );
      assert.ok(
        JSON.parse(entry.recipe.snapshotJSON).project.videoTracks.some(
          (t) => t.id === "recovery-track",
        ),
      );
      await writeFile(statePath, JSON.stringify({ ...report, saved: { entry, revision } }));
      console.log("Interrupting production process during durable rendering:", entry.id);
      process.stdout.write("RECOVERY_INTERRUPTED\n", () => process.exit(0));
    } else if (phase === 1) {
      const before = await until(
        async () =>
          (await rows()).find((r) => r.id === report.saved.entry.id && r.status === "interrupted"),
        "recovered interrupted export",
      );
      assert.deepEqual(before.recipe, report.saved.entry.recipe);
      await click("Export");
      await until(() => evalJS(`Boolean(${button("Retry from beginning")})`), "retry button");
      await click("Retry from beginning");
      const done = await until(
        async () => {
          const record = (await rows()).find((r) => r.id === before.id);
          if (record?.status === "failed") throw Error(record.error);
          return record?.status === "done" && record.outputFileID ? record : null;
        },
        "retry completion",
        180000,
      );
      assert.deepEqual(done.recipe, before.recipe);
      const bytes = await evalJS(
        `window.sidecutDesktop.storageGetFile(${JSON.stringify(done.outputFileID)})`,
      );
      const buffer = Buffer.from(Object.values(bytes));
      assert.ok(buffer.length > 0);
      const decoded = await evalJS(
        `(async()=>{const b=await window.sidecutDesktop.storageGetFile(${JSON.stringify(done.outputFileID)}); const u=URL.createObjectURL(new Blob([b],{type:${JSON.stringify(done.outputType)}})); const v=document.createElement('video'); v.src=u; await new Promise((ok,fail)=>{v.onloadeddata=ok;v.onerror=()=>fail(Error('video decode failed'));setTimeout(()=>fail(Error('video timeout')),10000)}); await v.play(); await new Promise((ok,fail)=>{const t=setTimeout(()=>fail(Error('playback timeout')),10000);v.ontimeupdate=()=>{if(v.currentTime>0.1){clearTimeout(t);ok()}}}); const result={time:v.currentTime,width:v.videoWidth,height:v.videoHeight};v.pause();URL.revokeObjectURL(u);return result})()`,
      );
      assert.ok(decoded.time > 0.1 && decoded.width && decoded.height);
      report.checks.rendering = {
        status: "pass",
        deliveryID: done.id,
        sourceRevision: report.saved.revision,
        outputFileID: done.outputFileID,
        bytes: buffer.length,
        sha256: createHash("sha256").update(buffer).digest("hex"),
        decoded,
        frozenRecipeRetained: true,
      };
      delete report.saved;
      stage = "nativeEncoding";
      const request = {
        codec: "hevc",
        videoBitrate: 1000000,
        audioBitrate: 64000,
        name: "recovery-native.mp4",
      };
      const inputID = done.outputFileID;
      const jobID = randomUUID();
      await evalJS(
        `window.sidecutDesktop.deliveryEncode(${JSON.stringify(jobID)}, ${JSON.stringify(inputID)}, ${JSON.stringify(request)}).catch(() => {}); true`,
      );
      const journal = await until(
        async () => {
          for (const name of await readdir(join(profile, "delivery-journal"))) {
            if (!name.endsWith(".json")) continue;
            const value = JSON.parse(
              await readFile(join(profile, "delivery-journal", name), "utf8"),
            );
            if (value.inputID === inputID && value.state === "encoding") {
              const part = await stat(
                join(profile, "storage-files", value.outputID + ".partial"),
              ).catch(() => null);
              if (part && part.size > 0) return { ...value, partialBytes: part.size };
            }
          }
          return null;
        },
        "active FFmpeg encoding output",
        60000,
      );
      report.savedNative = {
        journal,
        inputHash: createHash("sha256").update(buffer).digest("hex"),
      };
      await writeFile(statePath, JSON.stringify(report));
      console.log("NATIVE_ENCODING_INTERRUPT_READY", journal.outputID, journal.partialBytes);
      await new Promise(() => {});
    } else if (phase === 2) {
      stage = "nativeEncoding";
      const saved = report.savedNative;
      const journalPath = join(profile, "delivery-journal", saved.journal.outputID + ".json");
      const recovered = await until(async () => {
        const value = JSON.parse(await readFile(journalPath, "utf8"));
        return value.state === "failed" && value;
      }, "native encoding reconciliation");
      assert.deepEqual(recovered.request, saved.journal.request);
      assert.equal(recovered.inputID, saved.journal.inputID);
      await assert.rejects(stat(join(profile, "storage-files", recovered.outputID + ".partial")), {
        code: "ENOENT",
      });
      const readyBytes = Buffer.from(
        Object.values(
          await evalJS(
            `window.sidecutDesktop.storageGetFile(${JSON.stringify(saved.journal.inputID)})`,
          ),
        ),
      );
      assert.equal(createHash("sha256").update(readyBytes).digest("hex"), saved.inputHash);
      const badID = await evalJS("window.sidecutDesktop.storagePutFile(new Uint8Array([1,2,3,4]))");
      const failure = await evalJS(
        `window.sidecutDesktop.deliveryEncode(${JSON.stringify(randomUUID())}, ${JSON.stringify(badID)}, ${JSON.stringify(saved.journal.request)}).then(() => false, () => true)`,
      );
      assert.equal(failure, true);
      const after = Buffer.from(
        Object.values(
          await evalJS(
            `window.sidecutDesktop.storageGetFile(${JSON.stringify(saved.journal.inputID)})`,
          ),
        ),
      );
      assert.equal(createHash("sha256").update(after).digest("hex"), saved.inputHash);
      report.checks.nativeEncoding = {
        status: "pass",
        classification: "observed process-tree termination during native FFmpeg encoding",
        interruptedOutputID: recovered.outputID,
        partialBytesObserved: saved.journal.partialBytes,
        reconciledState: recovered.state,
        inputID: recovered.inputID,
        inputSha256: saved.inputHash,
        readyOutputUnchangedAfterRestartAndFailure: true,
      };
      await evalJS(
        `window.sidecutDesktop.deliveryEncode(${JSON.stringify(randomUUID())}, ${JSON.stringify(saved.journal.inputID)}, {codec:'h264',videoBitrate:1000000,audioBitrate:64000,name:'recovered.mp4'})`,
      );
      throw new Error("Publication fault barrier did not intercept the output link.");
    } else {
      stage = "publication";
      const saved = report.savedPublication;
      assert.equal(saved.journal.state, "verified");
      const recovered = await until(async () => {
        const value = JSON.parse(
          await readFile(
            join(profile, "delivery-journal", saved.journal.outputID + ".json"),
            "utf8",
          ),
        );
        return value.state === "published" && value;
      }, "verified output publication reconciliation");
      assert.deepEqual(recovered.result, saved.journal.result);
      const finalPath = join(profile, "storage-files", recovered.outputID);
      const finalBytes = await readFile(finalPath);
      assert.equal(createHash("sha256").update(finalBytes).digest("hex"), saved.sha256);
      assert.equal(finalBytes.length, saved.bytes);
      await assert.rejects(stat(finalPath + ".partial"), { code: "ENOENT" });
      assert.equal(
        await evalJS(
          `window.sidecutDesktop.storageFileDigest(${JSON.stringify(report.savedNative.journal.inputID)})`,
        ),
        report.savedNative.inputHash,
      );
      const decoded = await evalJS(
        `(async()=>{const bytes=await window.sidecutDesktop.storageGetFile(${JSON.stringify(recovered.outputID)});const url=URL.createObjectURL(new Blob([bytes],{type:'video/mp4'}));const video=document.createElement('video');video.muted=true;video.src=url;try{await new Promise((ok,fail)=>{video.onloadeddata=ok;video.onerror=()=>fail(Error('Reconciled MP4 decode failed'));setTimeout(()=>fail(Error('MP4 timeout')),10000)});await video.play();await new Promise((ok,fail)=>{const timer=setTimeout(()=>fail(Error('MP4 playback timeout')),10000);video.ontimeupdate=()=>{if(video.currentTime>0.1){clearTimeout(timer);ok()}}});return {time:video.currentTime,width:video.videoWidth,height:video.videoHeight}}finally{video.pause();URL.revokeObjectURL(url)}})()`,
      );
      assert.ok(decoded.time > 0.1 && decoded.width > 0 && decoded.height > 0);
      report.checks.nativeEncoding.subsequentOutputID = recovered.outputID;
      report.checks.nativeEncoding.subsequentOutputBytes = finalBytes.length;
      report.checks.publication = {
        status: "pass",
        classification:
          "fixture-only filesystem barrier after durable verification, followed by real process-tree termination and fresh-process reconciliation",
        outputID: recovered.outputID,
        bytes: finalBytes.length,
        sha256: saved.sha256,
        decoded,
        readyOutputUnchanged: true,
      };
      delete report.savedNative;
      delete report.savedPublication;
    }
  } catch (error) {
    report.errors.push({ stage, error: error.stack ?? String(error) });
    if (report.checks[stage]) report.checks[stage] = { status: "fail" };
  } finally {
    if (phase === 3 || report.errors.length) {
      report.accepted = Object.values(report.checks).every((x) => x.status === "pass");
      await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
      console.log(JSON.stringify(report));
      app.exit(report.errors.length ? 1 : 0);
    }
  }
}
void verify();
