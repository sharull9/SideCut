import { app, BrowserWindow } from "electron";
import { mkdtempSync } from "node:fs";
import { readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = resolve(import.meta.dirname, "../.."),
  profile = mkdtempSync(join(tmpdir(), "sidecut-adapters-"));
app.setPath("userData", profile);
app.setAppPath(join(root, "apps/desktop"));
process.env.SIDECUT_RENDERER_URL = "http://127.0.0.1:4270/";
let resultCode = 0;
const wait = async (predicate) => {
  const until = Date.now() + 30000;
  while (Date.now() < until) {
    const value = await predicate();
    if (value) return value;
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error("Adapter acceptance timed out.");
};
async function verify() {
  try {
    await import(pathToFileURL(join(root, "apps/desktop/dist/main.mjs")).href);
    await app.whenReady();
    const window = await wait(() => BrowserWindow.getAllWindows()[0]);
    await wait(() => !window.webContents.isLoading());
    const evaluate = (code) => window.webContents.executeJavaScript(code, true);
    await wait(() => evaluate("Boolean(document.querySelector('.editor-workspace'))"));
    const endpointFile = join(profile, "current.tandem.api.json");
    const discovery = JSON.parse(await readFile(endpointFile, "utf8"));
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
    const cli = async (...args) => {
      const result = await promisify(execFile)(
        process.execPath,
        [join(root, "scripts/sidecut-cli.mjs"), ...args, "--json", "--endpoint-file", endpointFile],
        { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, windowsHide: true },
      );
      return JSON.parse(result.stdout);
    };
    const initial = await call("status");
    const created = await cli(
      "new",
      "--name",
      "Adapter acceptance",
      "--expected-revision",
      String(initial.revision),
    );
    await new Promise((done) => setTimeout(done, 300));
    const edited = await cli(
      "apply",
      "--commands",
      JSON.stringify([
        { updateSettings: { patch: { width: 320, height: 180 } } },
        { addTrack: { id: "picture", name: "Picture", kind: "video" } },
        {
          insertClip: {
            trackID: "picture",
            clip: {
              id: "solid",
              content: { solid: { color: { r: 0.1, g: 0.4, b: 0.7, a: 1 } } },
              duration: 1,
            },
          },
        },
        {
          addMarker: { marker: { id: "comment", name: "Review this", time: 0.2, kind: "comment" } },
        },
      ]),
    );
    const inspected = await cli("status");
    assert.equal(inspected.name, "Adapter acceptance");
    assert.equal(inspected.revision, edited.revision);
    assert.equal((await call("comments")).comments[0].text, "Review this");
    assert.equal((await call("validate")).valid, true);
    assert.equal((await call("check", { quick: true })).frames, 0);
    assert.ok((await call("check", {})).frames > 0);
    const watch = call("watch", { revision: inspected.revision, timeout: 2 });
    await cli("apply", "--commands", JSON.stringify([{ removeMarker: { markerID: "comment" } }]));
    assert.equal((await watch).changed, true);
    assert.equal((await call("watch", { timeout: 0.02 })).changed, false);
    assert.equal((await call("wait", { what: "jobs", timeout: 1 })).done, true);
    const effects = await cli("effects");
    assert.ok(effects.effects.length > 10);
    const starter = await cli("assets", "install-starter");
    assert.equal(starter.downloaded, false);
    const providers = await cli("assets", "providers");
    assert.ok(providers.providers.length > 5);
    const search = await cli("assets", "search", "--limit", "3");
    assert.equal(search.local.length, 3);
    const remote = search.local[0];
    assert.equal((await call("assets-show", { id: remote.id })).asset.id, remote.id);
    await call("assets-fetch", { id: "import:missing-acceptance-asset" }, 404);
    await call("assets-generate", { prompt: "Do not call provider" }, 400);
    const fsRoot = "/@fs/" + root.replaceAll("\\", "/");
    const localID = await evaluate(`(async()=>{
      const {AssetLibrary}=await import(${JSON.stringify(fsRoot + "/packages/platform-browser/src/asset-library.ts")});
      const {decodeAsset}=await import(${JSON.stringify(fsRoot + "/packages/contracts/src/assets.ts")});
      const library=await AssetLibrary.open();
      try { const asset=decodeAsset({provider:'import',providerID:'runtime-svg',kind:'icon',name:'Runtime icon',tags:['runtime'],licenceClass:'noCredit',hasAlpha:true,width:32,height:32,state:'normalised'});
      const file=new File(['<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="blue"/></svg>'],'runtime.svg',{type:'image/svg+xml'});
      await library.put({asset,original:file,normalised:file});return asset.id; } finally {library.close();}
    })()`);
    assert.equal((await call("assets-fetch", { id: localID })).file, "runtime.svg");
    const used = await cli("assets", "use", "--id", localID);
    assert.ok(used.mediaID);
    await call("assets-credits");
    const saved = await cli(
      "segments",
      "save",
      "--name",
      "Runtime solid",
      "--clip-ids",
      '["solid"]',
    );
    const segments = await cli("segments", "list");
    assert.ok(segments.segments.some((s) => s.id === saved.segment.id));
    const inserted = await cli("segments", "insert", "--name", "Runtime solid", "--at", "1");
    assert.ok(inserted.revision > used.revision);
    await writeFile(
      join(profile, "replacement.wav"),
      await readFile(join(root, "tests/fixtures/audio/speech.wav")),
    );
    await call("apply", {
      commands: [
        {
          addMedia: {
            item: { id: "relink-source", path: "missing.wav", kind: "audio", hasAudio: true },
          },
        },
      ],
    });
    const relinked = await cli(
      "relink",
      "--media-id",
      "relink-source",
      "--path",
      "replacement.wav",
    );
    assert.deepEqual(relinked.relinked, ["relink-source"]);
    const archive = await cli("archive", "--output", "acceptance.sidecut");
    const archiveBytes = await readFile(archive.output);
    assert.equal(archiveBytes.readUInt32LE(0), 0x04034b50);
    const exported = await cli(
      "export",
      "--preset",
      "webm",
      "--to",
      "0.1",
      "--output",
      "acceptance.webm",
    );
    assert.ok(exported.bytes > 0);
    const status = await cli("status");
    const mcp = new Client({ name: "Electron acceptance", version: "1.0" });
    await mcp.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [join(root, "scripts/sidecut-mcp.mjs"), "--endpoint-file", endpointFile],
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
        stderr: "pipe",
      }),
    );
    const listed = await mcp.listTools();
    assert.equal(listed.tools.length, 43);
    const mcpEdit = await mcp.callTool({
      name: "apply",
      arguments: {
        commands: [{ updateProject: { patch: { name: "MCP edit" } } }],
        expectedRevision: status.revision,
        idempotencyKey: "mcp-runtime",
      },
    });
    assert.notEqual(mcpEdit.isError, true);
    await wait(async () => (await evaluate("document.body.innerText")).includes("MCP edit"));
    await mcp.callTool({ name: "undo", arguments: { expectedRevision: status.revision + 1 } });
    const mcpFrame = await mcp.callTool({
      name: "frame",
      arguments: { time: 0, maxWidth: 160, maxHeight: 90 },
    });
    assert.ok(mcpFrame.content.some((c) => c.type === "image" && c.mimeType === "image/png"));
    await mcp.close();
    await wait(
      async () =>
        (await evaluate("document.querySelector('[data-testid=project-name]').textContent")) ===
        "Adapter acceptance",
    );
    const sendKey = async (keyCode, modifiers = []) => {
      window.webContents.sendInputEvent({ type: "keyDown", keyCode, modifiers });
      window.webContents.sendInputEvent({ type: "keyUp", keyCode, modifiers });
      await new Promise((done) => setTimeout(done, 80));
    };
    await evaluate(
      "document.querySelector('.editor-clip-body').click();document.querySelector('.editor-timeline-scroll').focus()",
    );
    await wait(() =>
      evaluate("document.querySelectorAll('.editor-clip[data-selected=true]').length>0"),
    );
    const copiedCount = await evaluate(
      "document.querySelectorAll('.editor-clip[data-selected=true]').length",
    );
    assert.ok(copiedCount > 0);
    await sendKey("c", ["control"]);
    await evaluate("document.querySelector('[aria-label=\"Timeline playhead\"]').focus()");
    await sendKey("End");
    const beforePaste = await cli("status");
    await sendKey("v", ["control"]);
    try {
      await wait(async () => (await cli("status")).clips === beforePaste.clips + copiedCount);
    } catch (error) {
      console.error({
        copiedCount,
        beforePaste,
        afterPaste: await cli("status"),
        alerts: await evaluate(
          "[...document.querySelectorAll('[role=alert]')].map(e=>e.textContent)",
        ),
      });
      throw error;
    }
    await sendKey("z", ["control"]);
    await wait(async () => (await cli("status")).clips === beforePaste.clips);
    await evaluate("document.querySelector('[aria-label=\"Ripple range start seconds\"]').focus()");
    const beforeInput = await cli("status");
    await sendKey("Delete");
    assert.equal((await cli("status")).revision, beforeInput.revision);
    await evaluate("document.querySelector('[aria-label=\"Resize track Picture\"]').focus()");
    const heightBefore = await evaluate(
      "document.querySelector('[aria-label=\"Resize track Picture\"]').getAttribute('aria-valuenow')",
    );
    await sendKey("Down");
    assert.notEqual(
      await evaluate(
        "document.querySelector('[aria-label=\"Resize track Picture\"]').getAttribute('aria-valuenow')",
      ),
      heightBefore,
    );
    const lane = await evaluate(
      "(()=>{const r=document.querySelector('[data-track-id=picture]').getBoundingClientRect();return {x:r.left,y:r.top+12};})()",
    );
    const mouseDrag = async (start, end, modifiers = []) => {
      window.webContents.sendInputEvent({
        type: "mouseMove",
        x: Math.round(start.x),
        y: Math.round(start.y),
        modifiers,
      });
      window.webContents.sendInputEvent({
        type: "mouseDown",
        x: Math.round(start.x),
        y: Math.round(start.y),
        button: "left",
        clickCount: 1,
        modifiers,
      });
      window.webContents.sendInputEvent({
        type: "mouseMove",
        x: Math.round(end.x),
        y: Math.round(end.y),
        modifiers: [...modifiers, "leftButtonDown"],
      });
      window.webContents.sendInputEvent({
        type: "mouseUp",
        x: Math.round(end.x),
        y: Math.round(end.y),
        button: "left",
        clickCount: 1,
        modifiers,
      });
      await new Promise((done) => setTimeout(done, 120));
    };
    await mouseDrag({ x: lane.x + 180, y: lane.y }, { x: lane.x + 5, y: lane.y });
    assert.equal(
      await evaluate("document.querySelectorAll('.editor-clip-body[aria-pressed=true]').length"),
      2,
    );
    await mouseDrag({ x: lane.x + 180, y: lane.y }, { x: lane.x + 240, y: lane.y }, ["shift"]);
    assert.equal(
      await evaluate("document.querySelector('[aria-label=\"Ripple range start seconds\"]').value"),
      "3",
    );
    assert.equal(
      await evaluate("document.querySelector('[aria-label=\"Ripple range end seconds\"]').value"),
      "4",
    );
    await evaluate(
      "[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Export').click()",
    );
    await wait(() => evaluate("Boolean(document.querySelector('[role=dialog]'))"));
    await evaluate(
      "[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Queue export').click()",
    );
    await wait(() => evaluate("Boolean(document.querySelector('[download]'))"));
    const queuedDownload = await evaluate("document.querySelector('[download]').download");
    assert.ok(queuedDownload.endsWith(".webm"));
    await sendKey("Escape");
    await wait(() => evaluate("!document.querySelector('[role=dialog]')"));
    assert.ok((await evaluate("document.activeElement.textContent")).includes("Export"));
    await evaluate("document.activeElement.click()");
    await wait(() => evaluate("Boolean(document.querySelector('[role=dialog]'))"));
    assert.equal(await evaluate("document.querySelectorAll('[download]').length"), 1);
    await evaluate(
      "(()=>{const select=document.querySelector('[aria-label=\"Export preset\"]');const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;setter.call(select,'wav');select.dispatchEvent(new Event('change',{bubbles:true}));})()",
    );
    await evaluate(
      "[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Queue export').click()",
    );
    await wait(() => evaluate("Boolean(document.querySelector('[download$=\".wav\"]'))"));
    const wav = await evaluate(
      "fetch(document.querySelector('[download$=\".wav\"]').href).then(r=>r.arrayBuffer()).then(b=>({bytes:b.byteLength,magic:String.fromCharCode(...new Uint8Array(b).slice(0,4))}))",
    );
    assert.equal(wav.magic, "RIFF");
    assert.ok(wav.bytes > 44);
    await sendKey("Escape");
    await wait(() => evaluate("!document.querySelector('[role=dialog]')"));
    window.setContentSize(680, 800);
    await new Promise((done) => setTimeout(done, 300));
    const overflow = await evaluate("document.documentElement.scrollWidth>innerWidth");
    assert.equal(await evaluate("innerWidth"), 680);
    assert.equal(overflow, false);
    assert.equal(
      await evaluate(
        "(()=>{const header=document.querySelector('.editor-topbar').getBoundingClientRect();return [...document.querySelectorAll('.editor-topbar button,.editor-topbar a')].every(b=>{const r=b.getBoundingClientRect();return r.top>=header.top&&r.bottom<=header.bottom&&r.left>=0&&r.right<=innerWidth;});})()",
      ),
      true,
    );
    const require = createRequire(import.meta.url);
    await evaluate(await readFile(require.resolve("axe-core/axe.min.js"), "utf8"));
    const accessibility = await evaluate(
      "axe.run(document.querySelector('main'),{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}}).then(r=>({violations:r.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>n.target)})),passes:r.passes.length,incomplete:r.incomplete.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}))}))",
    );
    await writeFile(
      join(root, "docs/verification/phases-131-135-accessibility.json"),
      JSON.stringify(accessibility, null, 2) + "\n",
    );
    assert.deepEqual(accessibility.violations, []);
    const zoomContrast = await evaluate(
      "(()=>{const e=document.querySelector('[aria-label=\"Zoom out timeline\"]'),canvas=document.createElement('canvas');canvas.width=2;canvas.height=1;const c=canvas.getContext('2d');c.fillStyle='white';c.fillRect(0,0,2,1);const ancestors=[];for(let n=e;n;n=n.parentElement)ancestors.push(n);for(const n of ancestors.reverse()){c.fillStyle=getComputedStyle(n).backgroundColor;c.fillRect(0,0,2,1);}const bg=[...c.getImageData(0,0,1,1).data].slice(0,3);c.fillStyle=getComputedStyle(e).color;c.fillRect(1,0,1,1);const fg=[...c.getImageData(1,0,1,1).data].slice(0,3);const l=rgb=>rgb.map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);return {foreground:fg,background:bg,ratio:(Math.max(l(fg),l(bg))+.05)/(Math.min(l(fg),l(bg))+.05)};})()",
    );
    assert.ok(zoomContrast.ratio >= 4.5);
    accessibility.manualContrast = { target: "Zoom out timeline", ...zoomContrast };
    await writeFile(
      join(root, "docs/verification/phases-131-135-accessibility.json"),
      JSON.stringify(accessibility, null, 2) + "\n",
    );
    assert.ok((await evaluate("document.body.innerText")).includes("Adapter acceptance"));
    const evidence = {
      platform: process.platform,
      mcp: { tools: listed.tools.length, image: true, sharedUndo: true },
      interactions: {
        clipboard: true,
        undo: true,
        inputProtected: true,
        trackResize: true,
        marquee: true,
        range: true,
      },
      exportQueue: { download: queuedDownload, wavBytes: wav.bytes, retainedAfterClosing: true },
      accessibility: {
        width: 680,
        overflow,
        violations: accessibility.violations.length,
        passes: accessibility.passes,
      },
      created: { name: created.name },
      cli: { revision: status.revision, clips: status.clips, exportBytes: exported.bytes },
      review: { commentResolved: (await call("comments")).comments.length === 0, rendered: true },
      watch: { change: true, timeout: true },
      wait: { idle: true },
      resources: {
        effects: effects.effects.length,
        archiveBytes: archiveBytes.length,
        relink: relinked.relinked.length,
      },
      assets: {
        providers: providers.providers.length,
        starter: starter.assets,
        localUse: used.mediaID,
        downloads: false,
        generation: false,
      },
      segments: { saved: true, inserted: true },
      limits: [
        "This harness does not exercise reviewed baselines or sound matching",
        "This harness does not exercise automatic folder relink or standalone-folder archive",
        "No provider network calls or paid generation tested",
        "Windows development runtime; packaging has separate acceptance, native macOS/Linux remain unverified",
      ],
    };
    await writeFile(
      join(root, "docs/verification/phases-131-135-runtime.json"),
      JSON.stringify(evidence, null, 2) + "\n",
    );
    await writeFile(
      join(root, "docs/verification/phases-131-135-editor.png"),
      (await window.webContents.capturePage()).toPNG(),
    );
    console.log(JSON.stringify(evidence));
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
