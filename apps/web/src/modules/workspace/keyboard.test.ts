import { it, expect } from "vite-plus/test";
import { shortcut, ownsKey, workspaceShortcut, parseKeymap } from "./keyboard";
import { createEditorView } from "./editor-view";
import premiere from "../../../../../tests/fixtures/tandem/premiere-keymap.json";
it("accepts every binding in the pinned native Premiere map", () => {
  const bindings = parseKeymap(premiere);
  expect(Object.keys(bindings)).toHaveLength(Object.keys(premiere.bindings).length - 1);
  expect(bindings.delete).toBe("remove");
  expect(
    shortcut(
      {
        key: ">",
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        shiftKey: true,
        isComposing: false,
        defaultPrevented: false,
      },
      "premiere",
      bindings,
    ),
  ).toBe("nudgeRightFive");
  expect(() =>
    parseKeymap({ bindings: { delete: "lift", forwarddelete: "rippleDelete" } }),
  ).toThrow(/Conflicting/);
});

it("loads validated keymap overrides and dispatches transport and range commands", () => {
  const event = {
    key: "j",
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    isComposing: false,
    defaultPrevented: false,
  };
  expect(shortcut(event, "premiere")).toBe("shuttleReverse");
  expect(shortcut({ ...event, key: "i", altKey: true }, "premiere")).toBe("clearIn");
  const overrides = parseKeymap({ bindings: { "option+j": "bladeAtPlayhead", j: null } });
  expect(shortcut(event, "premiere", overrides)).toBeNull();
  expect(shortcut({ ...event, altKey: true }, "minimal", overrides)).toBe("split");
  expect(() => parseKeymap({ bindings: { j: "madeUp" } })).toThrow(/Unsupported/);
  const view = createEditorView();
  view.getState().shuttle(-1);
  view.getState().shuttle(-1);
  expect(view.getState()).toMatchObject({ playing: true, playbackRate: -2 });
  view.getState().shuttle(1);
  expect(view.getState().playbackRate).toBe(1);
  view.getState().shuttle(0);
  expect(view.getState().playing).toBe(false);
});
import { copyClips, pasteClips } from "./clipboard";
import { decodeProjectFile } from "@sidecut/contracts/project";
import { ProjectCoordinator } from "@sidecut/core/coordinator";
const key = (value: string, extra: Partial<KeyboardEvent> = {}) => ({
  key: value,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  isComposing: false,
  defaultPrevented: false,
  ...extra,
});
it("routes workspace commands with either platform modifier and preserves other chords", () => {
  for (const modifiers of [{ ctrlKey: true }, { metaKey: true }]) {
    expect(workspaceShortcut(key("s", modifiers))).toBe("save");
    expect(workspaceShortcut(key("o", modifiers))).toBe("open");
    expect(workspaceShortcut(key("e", modifiers))).toBe("export");
    for (const blocked of [
      { shiftKey: true },
      { altKey: true },
      { isComposing: true },
      { defaultPrevented: true },
    ])
      expect(workspaceShortcut(key("e", { ...modifiers, ...blocked }))).toBe(null);
  }
  expect(workspaceShortcut(key("e"))).toBe(null);
});
it("routes platform modifiers and suppresses composing/prevented events", () => {
  expect(shortcut(key("z", { ctrlKey: true }), "premiere")).toBe("undo");
  expect(shortcut(key("z", { metaKey: true, shiftKey: true }), "premiere")).toBe("redo");
  expect(shortcut(key("ArrowRight", { isComposing: true }), "premiere")).toBe(null);
  expect(shortcut(key("Delete", { defaultPrevented: true }), "premiere")).toBe(null);
  expect(shortcut(key(" "), "minimal")).toBe(null);
  expect(shortcut(key("i"), "premiere")).toBe("markIn");
  expect(shortcut(key("<", { shiftKey: true }), "premiere")).toBe("nudgeLeft");
  expect(shortcut(key(">", { shiftKey: true }), "premiere")).toBe("nudgeRight");
});
it("leaves keys to focused tabs, sliders, summaries and buttons", () => {
  const el = (...roles: string[]) =>
    ({ closest: (selector: string) => roles.find((r) => selector.includes(r)) ?? null }) as never;
  const tab = el("[role=tab]", '[role="tab"]'),
    summary = el("summary"),
    body = el();
  expect(ownsKey(tab, "forward")).toBe(true);
  expect(ownsKey(summary, "play")).toBe(true);
  expect(ownsKey(body, "play")).toBe(false);
  expect(ownsKey(body, "forward")).toBe(false);
  expect(ownsKey(null, "play")).toBe(false);
});
it("routes the extended Premiere chords without consuming unsupported shifted letters", () => {
  for (const [value, modifiers, action] of [
    ["a", {}, "selectForward"],
    ["a", { ctrlKey: true, shiftKey: true }, "selectForward"],
    ["m", { shiftKey: true }, "nextMarker"],
    ["m", { metaKey: true, shiftKey: true }, "previousMarker"],
    ["l", { ctrlKey: true }, "toggleLink"],
    ["z", { shiftKey: true }, "zoomToFit"],
    ["\\", {}, "zoomToFit"],
    ["=", { ctrlKey: true }, "zoomIn"],
    ["-", { metaKey: true }, "zoomOut"],
    ["Delete", { altKey: true }, "rippleRemove"],
    ["ArrowLeft", { altKey: true }, "nudgeLeft"],
    ["ArrowRight", { altKey: true }, "nudgeRight"],
    ["x", {}, "markClip"],
    ["m", {}, "addMarker"],
    ["v", { ctrlKey: true, altKey: true }, "addVideoTrack"],
    ["a", { metaKey: true, altKey: true }, "addAudioTrack"],
    ["q", {}, "rippleTrimStart"],
    ["w", {}, "rippleTrimEnd"],
    ["s", {}, "toggleSnapping"],
  ] as const) {
    expect(shortcut(key(value, modifiers), "premiere")).toBe(action);
    expect(shortcut(key(value, modifiers), "minimal")).toBe(null);
  }
  for (const value of ["i", "o", "a", "x", "ArrowUp", "ArrowDown"])
    expect(shortcut(key(value, { shiftKey: true }), "premiere")).toBe(null);
});
it("pastes with new IDs and link groups as one atomic undo step", () => {
  const file = decodeProjectFile({
    revision: 0,
    project: {
      id: "copy",
      videoTracks: [
        {
          id: "v",
          kind: "video",
          clips: [
            {
              id: "a",
              duration: 1,
              linkGroup: "original",
              content: { solid: { color: { r: 0, g: 0, b: 1, a: 1 } } },
            },
          ],
        },
      ],
    },
  });
  const clipboard = copyClips(file.project, ["a"]);
  let n = 0;
  const coordinator = new ProjectCoordinator(file);
  coordinator.apply({ commands: pasteClips(file.project, clipboard, 2, () => `new-${n++}`) });
  expect(coordinator.getSnapshot().project.videoTracks[0]?.clips).toMatchObject([
    { id: "a" },
    { id: "new-1", linkGroup: "new-0" },
  ]);
  coordinator.undo();
  expect(coordinator.getSnapshot().project.videoTracks[0]?.clips).toHaveLength(1);
  expect(() => pasteClips({ ...file.project, id: "other" }, clipboard, 0, () => "new")).toThrow(
    "another project",
  );
});
