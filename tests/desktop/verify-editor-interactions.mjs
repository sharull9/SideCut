// Repository Electron acceptance workflow: build:desktop and dev server :4270.
import { app, BrowserWindow } from "electron";
import { mkdtempSync } from "node:fs";
import { writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const root = resolve(import.meta.dirname, "../.."),
  profile = mkdtempSync(join(tmpdir(), "sidecut-editor-interactions-"));
app.setPath("userData", profile);
app.setAppPath(join(root, "apps/desktop"));
process.env.SIDECUT_RENDERER_URL = "http://127.0.0.1:4270";
let exitCode = 0;
const pause = (ms = 80) => new Promise((done) => setTimeout(done, ms));
async function wait(predicate) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await pause(100);
  }
  throw new Error("Interaction runtime timed out");
}
async function verify() {
  try {
    await import("../../apps/desktop/dist/main.mjs");
    await app.whenReady();
    const window = await wait(() => BrowserWindow.getAllWindows()[0]);
    window.setContentSize(1440, 960);
    const evaluate = async (code) => {
      try {
        return await window.webContents.executeJavaScript(code, true);
      } catch (error) {
        throw new Error(`Interaction evaluate failed: ${code.slice(0, 200)}`, { cause: error });
      }
    };
    await wait(() =>
      evaluate("Boolean(document.querySelector('.editor-workspace'))").catch(() => false),
    );
    window.show();
    window.focus();
    window.webContents.focus();
    const discovery = JSON.parse(await readFile(join(profile, "current.tandem.api.json"), "utf8"));
    const call = async (operation, input = {}) => {
      const response = await fetch(`http://127.0.0.1:${discovery.port}/v1/${operation}`, {
        method: "POST",
        headers: { authorization: `Bearer ${discovery.token}`, "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      const result = await response.json();
      assert.equal(response.status, 200, JSON.stringify(result));
      return result;
    };
    const original = (await call("timeline", { format: "json" })).project;
    await call("apply", {
      commands: [
        ...[...original.videoTracks, ...original.audioTracks].map((track) => ({
          removeTrack: { trackID: track.id },
        })),
        { updateSettings: { patch: { width: 320, height: 180 } } },
        { addTrack: { id: "v", name: "Picture", kind: "video" } },
        { addTrack: { id: "a", name: "Voice", kind: "audio" } },
        {
          addMedia: {
            item: { id: "voice", path: "voice.wav", kind: "audio", duration: 32, hasAudio: true },
          },
        },
        ...["first", "second", "far"].map((id, i) => ({
          insertClip: {
            trackID: "v",
            clip: {
              id,
              name: id,
              start: i === 2 ? 30 : i * 3,
              duration: 2,
              linkGroup: i === 0 ? "linked" : undefined,
              content: { solid: { color: { r: 0.2, g: 0.4, b: 0.7, a: 1 } } },
            },
          },
        })),
        {
          insertClip: {
            trackID: "a",
            clip: {
              id: "sound",
              name: "Linked sound",
              start: 0,
              duration: 2,
              linkGroup: "linked",
              content: { media: { mediaID: "voice" } },
            },
          },
        },
      ],
    });
    await wait(() => evaluate("Boolean(document.querySelector('[data-clip-id=first]'))"));
    await pause(300);
    await writeFile(
      join(profile, "baseline.png"),
      (await window.webContents.capturePage()).toPNG(),
    );
    if (process.argv.includes("--capture-only")) {
      console.log(join(profile, "baseline.png"));
      return;
    }
    const key = async (keyCode, modifiers = []) => {
      window.webContents.sendInputEvent({ type: "keyDown", keyCode, modifiers });
      window.webContents.sendInputEvent({ type: "keyUp", keyCode, modifiers });
      await pause();
    };
    const focus = async (selector) => {
      await evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`);
    };
    const rect = (selector) =>
      evaluate(
        `(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,x:r.left+r.width/2,y:r.top+r.height/2};})()`,
      );
    const mouse = async (type, point, modifiers = [], button = "left") => {
      window.webContents.sendInputEvent({
        type,
        x: Math.round(point.x),
        y: Math.round(point.y),
        button,
        clickCount: 1,
        modifiers,
      });
      await pause(25);
    };
    const click = async (selector, button = "left") => {
      const point = await rect(selector);
      await mouse("mouseMove", point, [], button);
      await mouse("mouseDown", point, [], button);
      await mouse("mouseUp", point, [], button);
      await pause();
    };
    const startDrag = async (start, end, modifiers = []) => {
      await mouse("mouseMove", start, modifiers);
      await mouse("mouseDown", start, modifiers);
      await mouse("mouseMove", end, [...modifiers, "leftButtonDown"]);
    };
    const drag = async (start, end, modifiers = []) => {
      await startDrag(start, end, modifiers);
      await mouse("mouseUp", end, modifiers);
      await pause();
    };
    const project = async () => (await call("timeline", { format: "json" })).project;
    const revision = async () => (await call("status")).revision;
    const selected = () =>
      evaluate(
        "[...document.querySelectorAll('.editor-clip[data-selected=true]')].map(e=>e.dataset.clipId).sort()",
      );
    const code = () =>
      evaluate("document.querySelector('[data-testid=timeline-timecode]').textContent");
    const zoom = async () =>
      Number.parseFloat(await evaluate("document.querySelector('.editor-zoom-label').textContent"));
    const scroll = () => evaluate("document.querySelector('.editor-timeline-scroll').scrollLeft");
    const resetScroll = () =>
      evaluate("document.querySelector('.editor-timeline-scroll').scrollLeft=0");
    const undo = async () => {
      const before = await revision();
      await focus(".editor-timeline-scroll");
      await key("z", ["control"]);
      await wait(async () => (await revision()) > before);
      await pause();
    };
    const baseline = await project(),
      evidence = {
        platform: process.platform,
        reference: "735a9b8e162c1f951044baa892d94993869f2e77",
      };
    await focus('[aria-label="Keyboard layout"]');
    await key("End");
    assert.equal(
      await evaluate("document.querySelector('[aria-label=\"Keyboard layout\"]').value"),
      "minimal",
    );
    await focus(".editor-timeline-scroll");
    const initialCode = await code();
    await key("Right");
    assert.equal(await code(), initialCode);
    await focus('[aria-label="Keyboard layout"]');
    await key("Home");
    await focus(".editor-timeline-scroll");
    await key("Right");
    assert.equal(await code(), "00:00:00:01");
    await key("Home");
    await key("Down");
    assert.equal(await code(), "00:00:02:00");
    await key("Down");
    assert.equal(await code(), "00:00:03:00");
    await key("Up");
    assert.equal(await code(), "00:00:02:00");
    await focus('[aria-label="Ripple range start seconds"]');
    await key("Right");
    assert.equal(await code(), "00:00:02:00");
    evidence.keymap = { minimalBlocksNavigation: true, premiereSteps: true, inputProtected: true };
    evidence.navigation = { nextEdit: 3, previousEdit: 2 };
    await click("[data-clip-id=first] .editor-clip-body");
    assert.deepEqual(await selected(), ["first", "sound"]);
    await focus(".editor-timeline-scroll");
    await key("c", ["control"]);
    await key("End");
    let before = await revision();
    await key("v", ["control"]);
    await wait(async () => (await revision()) > before);
    const pasted = await project(),
      newPicture = pasted.videoTracks[0].clips.find(
        (c) => !["first", "second", "far"].includes(c.id),
      ),
      newSound = pasted.audioTracks[0].clips.find((c) => c.id !== "sound");
    assert.ok(newPicture && newSound);
    assert.equal(newPicture.start, 32);
    assert.equal(newSound.start, 32);
    assert.equal(newPicture.linkGroup, newSound.linkGroup);
    assert.notEqual(newPicture.linkGroup, "linked");
    await wait(
      async () =>
        JSON.stringify(await selected()) === JSON.stringify([newPicture.id, newSound.id].sort()),
    );
    await undo();
    assert.deepEqual(await project(), baseline);
    await resetScroll();
    evidence.clipboard = {
      newClipIDs: true,
      newLinkGroup: true,
      relativeTiming: true,
      selectedPasted: true,
      oneUndo: true,
    };
    await click("[data-clip-id=second] .editor-clip-body", "right");
    await wait(() => evaluate("Boolean(document.querySelector('[role=menu]'))"));
    assert.deepEqual(await selected(), ["second"]);
    before = await revision();
    await key("Delete");
    assert.equal(await revision(), before);
    await writeFile(
      join(profile, "clip-menu.png"),
      (await window.webContents.capturePage()).toPNG(),
    );
    const require = createRequire(import.meta.url);
    await evaluate(await readFile(require.resolve("axe-core/axe.min.js"), "utf8"));
    const menuAccessibility = await evaluate(
      "axe.run(document.querySelector('[role=menu]'),{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}}).then(result=>({violations:result.violations.map(item=>({id:item.id,targets:item.nodes.map(node=>node.target)})),passes:result.passes.length}))",
    );
    assert.deepEqual(menuAccessibility.violations, []);
    evidence.menuAccessibility = menuAccessibility;
    await key("Escape");
    await wait(() => evaluate("!document.querySelector('[role=menu]')"));
    assert.equal(
      await evaluate("document.activeElement.getAttribute('aria-label')"),
      "Select clip second",
    );
    await focus("[data-clip-id=first] .editor-clip-body");
    await key("F10", ["shift"]);
    await wait(() => evaluate("Boolean(document.querySelector('[role=menu]'))"));
    await key("Home");
    await key("Enter");
    await wait(() => evaluate("!document.querySelector('[role=menu]')"));
    assert.deepEqual(await selected(), ["first", "sound"]);
    await click("[data-clip-id=second] .editor-clip-body", "right");
    await wait(() => evaluate("Boolean(document.querySelector('[role=menu]'))"));
    before = await revision();
    const lift = await evaluate(
      "(()=>{const e=[...document.querySelectorAll('[role=menuitem]')].find(item=>item.textContent==='Lift selection'),r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()",
    );
    await mouse("mouseMove", lift);
    await mouse("mouseDown", lift);
    await mouse("mouseUp", lift);
    await wait(async () => (await revision()) > before);
    assert.ok(!(await project()).videoTracks[0].clips.some((clip) => clip.id === "second"));
    await undo();
    assert.deepEqual(await project(), baseline);
    evidence.contextMenu = {
      pointer: true,
      keyboard: true,
      escapeRestoresFocus: true,
      editingKeysProtected: true,
    };
    await focus(".editor-timeline-scroll");
    await key("Escape");
    await key("Home");
    await resetScroll();
    const lane = await rect("[data-track-id=v]");
    const lanePoint = { x: lane.left + 360, y: lane.top + 3 },
      laneEnd = { x: lane.left + 10, y: lane.top + 3 };
    await drag(lanePoint, laneEnd);
    assert.deepEqual(await selected(), ["first", "second", "sound"]);
    await startDrag(
      { x: lane.left + 400, y: lane.top + 3 },
      { x: lane.left + 450, y: lane.top + 3 },
    );
    await key("Escape");
    await mouse("mouseUp", { x: lane.left + 450, y: lane.top + 3 });
    assert.deepEqual(await selected(), ["first", "second", "sound"]);
    await focus(".editor-timeline-scroll");
    await key("Home");
    await key("i");
    await key("Down");
    await key("o");
    const rangeBefore = await evaluate(
      "[...document.querySelectorAll('[aria-label^=\"Ripple range\"]')].map(e=>e.value)",
    );
    await startDrag(lanePoint, { x: lane.left + 450, y: lane.top + 3 }, ["shift"]);
    await key("Escape");
    await mouse("mouseUp", { x: lane.left + 450, y: lane.top + 3 }, ["shift"]);
    assert.deepEqual(
      await evaluate(
        "[...document.querySelectorAll('[aria-label^=\"Ripple range\"]')].map(e=>e.value)",
      ),
      rangeBefore,
    );
    evidence.marquee = {
      selectsOverlappingClips: true,
      linkedSelection: true,
      escapeRestoresSelection: true,
      escapeRestoresRange: true,
    };
    await focus(".editor-timeline-scroll");
    await key("l", ["control", "shift"]);
    await drag(lanePoint, laneEnd);
    assert.deepEqual(await selected(), ["first", "second"]);
    const audioLane = await rect("[data-track-id=a]");
    await drag(lanePoint, { x: laneEnd.x, y: audioLane.bottom - 3 });
    assert.deepEqual(await selected(), ["first", "second", "sound"]);
    await key("l", ["control", "shift"]);
    evidence.marquee.crossTrackWithoutLinks = true;
    evidence.marquee.linkedSelectionToggle = true;
    await focus(".editor-timeline-scroll");
    await key("Escape");
    await key("Home");
    const body = await rect("[data-clip-id=second] .editor-clip-body");
    // At 60 px/s, dragging the second clip 55px left snaps its start to 2s.
    before = await revision();
    await drag(body, { x: body.x - 55, y: body.y });
    await wait(async () => (await revision()) > before);
    assert.equal((await project()).videoTracks[0].clips.find((c) => c.id === "second").start, 2);
    await undo();
    before = await revision();
    await drag(body, { x: body.x - 55, y: body.y }, ["control"]);
    await wait(async () => (await revision()) > before);
    const unsnapped = (await project()).videoTracks[0].clips.find((c) => c.id === "second").start;
    assert.ok(Math.abs(unsnapped - 2.1) < 0.04);
    await undo();
    before = await revision();
    await drag(body, { x: body.x - 55, y: body.y }, ["shift"]);
    await wait(async () => (await revision()) > before);
    assert.ok(
      Math.abs(
        (await project()).videoTracks[0].clips.find((c) => c.id === "second").start - unsnapped,
      ) < 1e-6,
    );
    await undo();
    await focus(".editor-timeline-scroll");
    await key("s");
    assert.equal(
      await evaluate(
        "document.querySelector('[aria-label=\"Toggle snapping\"]').getAttribute('aria-pressed')",
      ),
      "false",
    );
    before = await revision();
    await drag(body, { x: body.x - 55, y: body.y });
    await wait(async () => (await revision()) > before);
    assert.ok(
      Math.abs(
        (await project()).videoTracks[0].clips.find((clip) => clip.id === "second").start -
          unsnapped,
      ) < 1e-6,
    );
    await undo();
    await evaluate(
      "document.querySelector('.editor-timeline-scroll').dispatchEvent(new KeyboardEvent('keydown',{key:'s',repeat:true,bubbles:true}))",
    );
    assert.equal(
      await evaluate(
        "document.querySelector('[aria-label=\"Toggle snapping\"]').getAttribute('aria-pressed')",
      ),
      "false",
    );
    await focus('[aria-label="Ripple range start seconds"]');
    await key("s");
    assert.equal(
      await evaluate(
        "document.querySelector('[aria-label=\"Toggle snapping\"]').getAttribute('aria-pressed')",
      ),
      "false",
    );
    await focus('[aria-label="Toggle snapping"]');
    await key("Space");
    assert.equal(
      await evaluate(
        "document.querySelector('[aria-label=\"Toggle snapping\"]').getAttribute('aria-pressed')",
      ),
      "true",
    );
    await startDrag(body, { x: body.x + 30, y: body.y });
    await key("Escape");
    await mouse("mouseUp", { x: body.x + 30, y: body.y });
    assert.deepEqual(await project(), baseline);
    evidence.snapping = {
      defaultSnaps: true,
      controlBypass: true,
      shiftMoveBypass: true,
      cancelPreservesProject: true,
      keyboardToggle: true,
      buttonToggle: true,
      repeatIgnored: true,
      toggleInputProtected: true,
    };
    await focus("[data-clip-id=first] .editor-clip-body");
    await key("Enter");
    assert.deepEqual(await selected(), ["first", "sound"]);
    evidence.snapping.keyboardActivationAfterCancel = true;
    await focus(".editor-timeline-scroll");
    const initialZoom = await zoom();
    await key("=");
    assert.ok((await zoom()) > initialZoom);
    await key("-");
    assert.equal(await zoom(), initialZoom);
    const scroller = await rect(".editor-timeline-scroll");
    window.webContents.sendInputEvent({
      type: "mouseWheel",
      x: Math.round(scroller.x),
      y: Math.round(scroller.y),
      deltaX: -120,
      deltaY: 0,
    });
    await wait(async () => (await scroll()) > 0);
    const wheelBefore = await zoom();
    window.webContents.sendInputEvent({
      type: "mouseWheel",
      x: Math.round(scroller.x),
      y: Math.round(scroller.y),
      deltaX: 0,
      deltaY: 50,
      modifiers: ["control"],
    });
    await pause(200);
    assert.ok((await zoom()) > wheelBefore);
    await focus('[aria-label="Ripple range start seconds"]');
    const inputZoom = await zoom();
    await key("=");
    assert.equal(await zoom(), inputZoom);
    await focus(".editor-timeline-scroll");
    await key("-");
    await resetScroll();
    evidence.scrollZoom = {
      horizontalWheel: true,
      modifierWheelZoom: true,
      keyboardZoom: true,
      inputProtected: true,
    };
    const moving = await rect("[data-clip-id=second] .editor-clip-body"),
      edge = { x: scroller.right - 12, y: moving.y };
    before = await revision();
    await startDrag(moving, edge);
    const scrollOnce = await scroll();
    await pause(400);
    const scrollHeld = await scroll();
    assert.ok(scrollHeld > scrollOnce + 30);
    await key("Escape");
    await mouse("mouseUp", edge);
    const scrollStop = await scroll();
    await pause(200);
    assert.equal(await scroll(), scrollStop);
    assert.equal(await revision(), before);
    await resetScroll();
    evidence.autoscroll = {
      stationaryPointerContinues: true,
      delta: scrollHeld - scrollOnce,
      escapeStops: true,
      noEditOnCancel: true,
    };
    await click("[data-clip-id=second] .editor-clip-body");
    await focus(".editor-timeline-scroll");
    before = await revision();
    await key(".");
    await wait(async () => (await revision()) > before);
    assert.ok(
      Math.abs(
        (await project()).videoTracks[0].clips.find((c) => c.id === "second").start - (3 + 1 / 30),
      ) < 1e-6,
    );
    await undo();
    before = await revision();
    await key(">", ["shift"]);
    await wait(async () => (await revision()) > before);
    assert.ok(
      Math.abs(
        (await project()).videoTracks[0].clips.find((c) => c.id === "second").start - (3 + 5 / 30),
      ) < 1e-6,
    );
    await undo();
    await focus('[aria-label="Trim end second"]');
    before = await revision();
    await key("Left", ["shift"]);
    await wait(async () => (await revision()) > before);
    assert.ok(
      Math.abs(
        (await project()).videoTracks[0].clips.find((c) => c.id === "second").duration -
          (2 - 5 / 30),
      ) < 1e-6,
    );
    await undo();
    await call("apply", { commands: [{ updateTrack: { trackID: "v", patch: { locked: true } } }] });
    await pause();
    before = await revision();
    await focus(".editor-timeline-scroll");
    await key(".");
    await pause();
    assert.equal(await revision(), before);
    assert.match(await evaluate("document.body.innerText"), /locked/i);
    evidence.keyboardEdits = {
      oneFrameMove: true,
      fiveFrameMove: true,
      fiveFrameTrim: true,
      lockedTrackRejected: true,
    };
    await call("undo");
    await pause();
    await focus(".editor-timeline-scroll");
    await key("Home");
    await key("Down");
    await key("Down");
    assert.equal(await code(), "00:00:03:00");
    await key("x");
    assert.deepEqual(
      await evaluate(
        "[document.querySelector('[aria-label=\"Ripple range start seconds\"]').value,document.querySelector('[aria-label=\"Ripple range end seconds\"]').value]",
      ),
      ["3", "5"],
    );
    await key("a");
    assert.deepEqual(await selected(), ["far", "second"]);
    await key("Escape");
    await key("a", ["control", "shift"]);
    assert.deepEqual(await selected(), ["far", "second"]);
    before = await revision();
    await key("l", ["control"]);
    await wait(async () => (await revision()) > before);
    let linked = (await project()).videoTracks[0].clips.filter((clip) =>
      ["second", "far"].includes(clip.id),
    );
    assert.ok(linked[0].linkGroup && linked[0].linkGroup === linked[1].linkGroup);
    before = await revision();
    await key("l", ["control"]);
    await wait(async () => (await revision()) > before);
    linked = (await project()).videoTracks[0].clips.filter((clip) =>
      ["second", "far"].includes(clip.id),
    );
    assert.ok(linked.every((clip) => !clip.linkGroup));
    await undo();
    await undo();
    await click('[aria-label="Fit"]');
    const fitZoom = await zoom();
    await focus(".editor-timeline-scroll");
    await key("=", ["control"]);
    assert.ok((await zoom()) > fitZoom);
    await key("z", ["shift"]);
    assert.equal(await zoom(), fitZoom);
    await key("=", ["control"]);
    await key("\\");
    assert.equal(await zoom(), fitZoom);
    await call("apply", {
      commands: [
        { addMarker: { marker: { id: "early", time: 6, name: "Early" } } },
        { addMarker: { marker: { id: "late", time: 12, name: "Late" } } },
        { updateTrack: { trackID: "v", patch: { targeted: false } } },
      ],
    });
    await pause();
    await key("Home");
    await key("Down");
    assert.equal(await code(), "00:00:02:00");
    await key("Down");
    assert.equal(await code(), "00:00:02:00");
    await key("m", ["shift"]);
    assert.equal(await code(), "00:00:06:00");
    await key("m", ["shift"]);
    assert.equal(await code(), "00:00:12:00");
    await key("m", ["control", "shift"]);
    assert.equal(await code(), "00:00:06:00");
    await focus('[aria-label="Ripple range start seconds"]');
    await key("m", ["shift"]);
    assert.equal(await code(), "00:00:06:00");
    await undo();
    assert.deepEqual(await project(), baseline);
    evidence.extendedKeymap = {
      markTargetedClip: true,
      selectForward: true,
      modifierSelectForward: true,
      linkAndUnlink: true,
      modifierZoom: true,
      fitAliases: true,
      targetedEditNavigation: true,
      markerNavigation: true,
      inputProtected: true,
    };
    await focus(".editor-timeline-scroll");
    await key("e", ["control"]);
    await wait(() => evaluate("Boolean(document.querySelector('.editor-export-dialog'))"));
    await wait(() => evaluate("Boolean(document.activeElement.closest('.editor-export-dialog'))"));
    before = await revision();
    await key("Delete");
    assert.equal(await revision(), before);
    await key("Escape");
    await wait(() => evaluate("!document.querySelector('.editor-export-dialog')"));
    await focus('[aria-label="Ripple range start seconds"]');
    await key("e", ["control"]);
    assert.equal(await evaluate("Boolean(document.querySelector('.editor-export-dialog'))"), false);
    await evaluate(
      "window.pickerClicks=0;document.querySelector('[aria-label=\"Project, archive, EDL recipe, or Filmora file\"]').addEventListener('click',event=>{event.preventDefault();window.pickerClicks++},{once:true})",
    );
    await focus(".editor-timeline-scroll");
    await key("o", ["control"]);
    assert.equal(await evaluate("window.pickerClicks"), 1);
    before = await revision();
    await key("s", ["control"]);
    await pause();
    assert.equal(await revision(), before);
    assert.equal(
      await evaluate("document.querySelector('.editor-session-label').dataset.state"),
      "saved",
    );
    evidence.workspaceShortcuts = {
      exportDialog: true,
      dialogBlocksDelete: true,
      inputProtected: true,
      pickerDispatch: true,
      saveKeepsRevision: true,
    };
    await focus(".editor-timeline-scroll");
    await key("Home");
    await key("Right");
    before = await revision();
    await key("m");
    await wait(async () => (await revision()) > before);
    assert.ok(Math.abs((await project()).markers.at(-1).time - 1 / 30) < 1e-6);
    await undo();
    before = await revision();
    await key("v", ["control", "alt"]);
    await wait(async () => (await revision()) > before);
    assert.equal((await project()).videoTracks.length, 2);
    await undo();
    before = await revision();
    await key("a", ["control", "alt"]);
    await wait(async () => (await revision()) > before);
    assert.equal((await project()).audioTracks.length, 2);
    await undo();
    assert.deepEqual(await project(), baseline);
    before = await revision();
    await focus('[aria-label="Ripple range start seconds"]');
    await key("m");
    assert.equal(await revision(), before);
    evidence.creationShortcuts = {
      markerAtPlayhead: true,
      videoTrack: true,
      audioTrack: true,
      oneStepUndo: true,
      inputProtected: true,
    };
    await click("[data-clip-id=second] .editor-clip-body");
    await focus(".editor-timeline-scroll");
    await key("Home");
    await key("Down");
    await key("Down");
    for (let frame = 0; frame < 6; frame++) await key("Right", ["shift"]);
    assert.equal(await code(), "00:00:04:00");
    before = await revision();
    await key("q");
    await wait(async () => (await revision()) > before);
    let trimmed = (await project()).videoTracks[0].clips.find((clip) => clip.id === "second");
    assert.equal(trimmed.start, 3);
    assert.equal(trimmed.duration, 1);
    assert.equal(trimmed.sourceStart, 1);
    assert.equal(await code(), "00:00:03:00");
    before = await revision();
    await key("q");
    assert.equal(await revision(), before);
    await undo();
    assert.deepEqual(await project(), baseline);
    for (let frame = 0; frame < 6; frame++) await key("Right", ["shift"]);
    before = await revision();
    await key("w");
    await wait(async () => (await revision()) > before);
    trimmed = (await project()).videoTracks[0].clips.find((clip) => clip.id === "second");
    assert.equal(trimmed.start, 3);
    assert.equal(trimmed.duration, 1);
    assert.equal(await code(), "00:00:04:00");
    await undo();
    assert.deepEqual(await project(), baseline);
    evidence.playheadTrim = {
      start: true,
      end: true,
      startMovesPlayheadToEdit: true,
      endKeepsPlayhead: true,
      boundaryNoop: true,
      oneStepUndo: true,
    };
    await call("apply", {
      commands: [
        {
          addMedia: {
            item: {
              id: "slip-media",
              path: "slip-source.webm",
              kind: "video",
              duration: 20,
              hasVideo: true,
            },
          },
        },
        {
          updateClip: {
            clipID: "second",
            patch: {
              sourceStart: 2,
              speed: 2,
              content: { solid: null, media: { mediaID: "slip-media" } },
            },
          },
        },
      ],
    });
    await pause();
    await resetScroll();
    const slipStart = await rect("[data-clip-id=second] .editor-clip-body");
    const slipZoom = await evaluate(
      "document.querySelector('[data-clip-id=second]').getBoundingClientRect().width/2",
    );
    before = await revision();
    const slipEnd = { x: slipStart.x + slipZoom * 0.5, y: slipStart.y };
    await startDrag(slipStart, slipEnd, ["alt"]);
    await mouse("mouseUp", slipEnd, ["alt"]);
    await wait(async () => (await revision()) > before);
    const slipped = (await project()).videoTracks[0].clips.find((clip) => clip.id === "second");
    assert.ok(
      Math.abs(slipped.sourceStart - 1) < 0.08,
      `Rightward half-second slip at 2x speed chose source ${slipped.sourceStart}`,
    );
    assert.equal(slipped.start, 3);
    assert.equal(slipped.duration, 2);
    await undo();
    await undo();
    assert.deepEqual(await project(), baseline);
    evidence.slipGesture = {
      rightDragRevealsEarlierSource: true,
      scalesWithClipSpeed: true,
      timelinePositionUnchanged: true,
    };
    await focus('[aria-label="Keyboard layout"]');
    await key("End");
    const storedKeymap = () =>
      evaluate(
        "(async()=>{const {readPreference}=await import('/@fs/" +
          root.replaceAll("\\", "/") +
          "/packages/platform-browser/src/preferences.ts');return readPreference('sidecut.keymap.v1')})()",
      );
    await wait(async () => (await storedKeymap()) === "minimal");
    window.webContents.reload();
    await wait(() =>
      evaluate("Boolean(document.querySelector('.editor-workspace'))").catch(() => false),
    );
    await wait(() =>
      evaluate("document.querySelector('[aria-label=\"Keyboard layout\"]')?.value === 'minimal'"),
    );
    await focus(".editor-timeline-scroll");
    const reopenedCode = await code();
    await key("Right");
    assert.equal(await code(), reopenedCode);
    await focus('[aria-label="Keyboard layout"]');
    await key("Home");
    await wait(async () => (await storedKeymap()) === "premiere");
    evidence.keymapPersistence = {
      selectionSurvivesReopen: true,
      minimalStillProtectsNavigation: true,
      restoredPremiere: true,
    };
    await click('[aria-label="Keyboard shortcuts"]');
    const custom = JSON.parse(
      await readFile(join(root, "tests/fixtures/tandem/premiere-keymap.json"), "utf8"),
    );
    custom.bindings.f9 = "toolBlade";
    custom.bindings.j = null;
    await evaluate(
      `(()=>{const input=document.querySelector('#custom-keymap'),transfer=new DataTransfer();transfer.items.add(new File([${JSON.stringify(JSON.stringify(custom))}],'native-keymap.json',{type:'application/json'}));input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`,
    );
    await wait(() =>
      evaluate(
        "[...document.querySelectorAll('button')].some(button=>/Reset .* custom bindings/.test(button.textContent))",
      ),
    );
    await key("Escape");
    await focus(".editor-timeline-scroll");
    await key("F9");
    assert.equal(
      await evaluate("document.querySelector('[aria-label=\"Timeline tool\"]').value"),
      "blade",
    );
    await key("v");
    window.webContents.reload();
    await wait(() =>
      evaluate("Boolean(document.querySelector('.editor-workspace'))").catch(() => false),
    );
    await click('[aria-label="Keyboard shortcuts"]');
    await wait(() =>
      evaluate(
        "[...document.querySelectorAll('button')].some(button=>/Reset .* custom bindings/.test(button.textContent))",
      ),
    );
    await key("Escape");
    await focus(".editor-timeline-scroll");
    await key("F9");
    await wait(() =>
      evaluate("document.querySelector('[aria-label=\"Timeline tool\"]')?.value === 'blade'"),
    );
    await click('[aria-label="Keyboard shortcuts"]');
    await evaluate(
      "[...document.querySelectorAll('button')].find(button=>/Reset .* custom bindings/.test(button.textContent)).click()",
    );
    await key("Escape");
    await focus(".editor-timeline-scroll");
    await key("v");
    evidence.customKeymap = {
      nativeFileImport: true,
      toolDispatch: true,
      persistsOnReload: true,
      reset: true,
    };
    await writeFile(
      join(root, "docs/verification/editor-parity.png"),
      (await window.webContents.capturePage()).toPNG(),
    );
    evidence.limits = [
      "Windows Electron keyboard/pointer workflow",
      "Clipboard stays in one project; transitions require saved segments",
      "Managed browser interaction subset; native macOS/Linux gestures unverified",
    ];
    await writeFile(
      join(root, "docs/verification/editor-interactions-runtime.json"),
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
