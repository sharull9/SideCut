export type Shortcut =
  | "split"
  | "remove"
  | "rippleRemove"
  | "undo"
  | "redo"
  | "copy"
  | "paste"
  | "selectAll"
  | "selectForward"
  | "toggleLink"
  | "addMarker"
  | "addVideoTrack"
  | "addAudioTrack"
  | "rippleTrimStart"
  | "rippleTrimEnd"
  | "toggleSnapping"
  | "clear"
  | "play"
  | "back"
  | "forward"
  | "previous"
  | "next"
  | "previousMarker"
  | "nextMarker"
  | "home"
  | "end"
  | "zoomIn"
  | "zoomOut"
  | "zoomToFit"
  | "nudgeLeft"
  | "nudgeRight"
  | "markIn"
  | "markOut"
  | "markClip"
  | "shuttleReverse"
  | "shuttleStop"
  | "shuttleForward"
  | "clearIn"
  | "clearOut"
  | "clearInOut"
  | "liftInOut"
  | "extractInOut"
  | "freezeFrame"
  | "toggleKeyframe"
  | "previousKeyframe"
  | "nextKeyframe"
  | "layoutFull"
  | "layoutPipRight"
  | "layoutPipLeft"
  | "layoutSplit"
  | "toolSelect"
  | "toolBlade"
  | "toolRippleTrim"
  | "toolRoll"
  | "toolSlip"
  | "toolSlide"
  | "toggleLinkedSelection"
  | "toggleRipple"
  | "toggleTranscriptLane"
  | "toggleSafeMargins"
  | "backFive"
  | "forwardFive"
  | "nudgeLeftFive"
  | "nudgeRightFive"
  | "addComment"
  | "addSectionCards"
  | "addTransition"
  | "toggleProxy"
  | "previousAgentChange"
  | "nextAgentChange"
  | "markAgentChangesReviewed"
  | "save"
  | "saveVersion"
  | "export"
  | "newProject"
  | "openProject";
export type KeymapOverrides = Record<string, Shortcut | null>;
const nativeCommands: Record<string, Shortcut> = {
  playPause: "play",
  stepBack: "back",
  stepForward: "forward",
  goToStart: "home",
  goToEnd: "end",
  previousEdit: "previous",
  nextEdit: "next",
  bladeAtPlayhead: "split",
  lift: "remove",
  rippleDelete: "rippleRemove",
  link: "toggleLink",
  deselectAll: "clear",
  stepBackFive: "backFive",
  stepForwardFive: "forwardFive",
};
const extraCommands = [
  "shuttleReverse",
  "shuttleStop",
  "shuttleForward",
  "clearIn",
  "clearOut",
  "clearInOut",
  "liftInOut",
  "extractInOut",
  "freezeFrame",
  "toggleKeyframe",
  "previousKeyframe",
  "nextKeyframe",
  "layoutFull",
  "layoutPipRight",
  "layoutPipLeft",
  "layoutSplit",
  "toolSelect",
  "toolBlade",
  "toolRippleTrim",
  "toolRoll",
  "toolSlip",
  "toolSlide",
  "toggleLinkedSelection",
  "toggleRipple",
  "toggleTranscriptLane",
  "toggleSafeMargins",
  "backFive",
  "forwardFive",
  "nudgeLeftFive",
  "nudgeRightFive",
  "addComment",
  "addSectionCards",
  "addTransition",
  "toggleProxy",
  "previousAgentChange",
  "nextAgentChange",
  "markAgentChangesReviewed",
  "save",
  "saveVersion",
  "export",
  "newProject",
  "openProject",
] as const;
function combo(parts: string[]) {
  return parts
    .map(
      (part) =>
        ({
          cmd: "mod",
          ctrl: "mod",
          meta: "mod",
          option: "alt",
          space: " ",
          left: "arrowleft",
          right: "arrowright",
          up: "arrowup",
          down: "arrowdown",
          forwarddelete: "delete",
          "<": ",",
          ">": ".",
          '"': "'",
          ":": ";",
          "?": "/",
        })[part] ?? part,
    )
    .sort()
    .join("+");
}
export function parseKeymap(value: unknown): KeymapOverrides {
  if (
    !value ||
    typeof value !== "object" ||
    !("bindings" in value) ||
    !value.bindings ||
    typeof value.bindings !== "object" ||
    Array.isArray(value.bindings)
  )
    throw new Error("Choose a keymap JSON object with a bindings object.");
  const result: KeymapOverrides = {};
  for (const [keys, raw] of Object.entries(value.bindings)) {
    const command = typeof raw === "string" ? (nativeCommands[raw] ?? raw) : raw;
    const supported: readonly Shortcut[] = [
      ...extraCommands,
      "split",
      "remove",
      "rippleRemove",
      "undo",
      "redo",
      "copy",
      "paste",
      "selectAll",
      "selectForward",
      "toggleLink",
      "addMarker",
      "addVideoTrack",
      "addAudioTrack",
      "rippleTrimStart",
      "rippleTrimEnd",
      "toggleSnapping",
      "clear",
      "play",
      "back",
      "forward",
      "previous",
      "next",
      "previousMarker",
      "nextMarker",
      "home",
      "end",
      "zoomIn",
      "zoomOut",
      "zoomToFit",
      "nudgeLeft",
      "nudgeRight",
      "markIn",
      "markOut",
      "markClip",
    ];
    const action = supported.find((name) => name === command);
    if (command !== null && !action) throw new Error(`Unsupported keymap command: ${String(raw)}.`);
    const normalized = combo(keys.toLowerCase().split("+"));
    if (
      !normalized ||
      (Object.hasOwn(result, normalized) && result[normalized] !== (action ?? null))
    )
      throw new Error(`Conflicting or empty binding: ${keys}.`);
    result[normalized] = action ?? null;
  }
  return result;
}
type ShortcutEvent = Pick<
  KeyboardEvent,
  "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey" | "isComposing" | "defaultPrevented"
>;
export function hasKeymapOverride(event: ShortcutEvent, overrides: KeymapOverrides) {
  return Object.hasOwn(
    overrides,
    combo([
      ...(event.ctrlKey || event.metaKey ? ["mod"] : []),
      ...(event.altKey ? ["alt"] : []),
      ...(event.shiftKey ? ["shift"] : []),
      event.key.toLowerCase(),
    ]),
  );
}
export function shortcut(
  event: ShortcutEvent,
  keymap: "premiere" | "minimal",
  overrides: KeymapOverrides = {},
): Shortcut | null {
  if (event.defaultPrevented || event.isComposing) return null;
  const key = event.key.toLowerCase(),
    mod = event.ctrlKey || event.metaKey;
  const binding = combo([
    ...(mod ? ["mod"] : []),
    ...(event.altKey ? ["alt"] : []),
    ...(event.shiftKey ? ["shift"] : []),
    key,
  ]);
  if (Object.hasOwn(overrides, binding)) return overrides[binding] ?? null;
  if (keymap === "premiere") {
    if (mod && !event.altKey) {
      if (key === "s") return event.shiftKey ? "saveVersion" : "save";
      if (!event.shiftKey && key === "n") return "newProject";
      if (!event.shiftKey && key === "o") return "openProject";
      if (!event.shiftKey && key === "e") return "export";
      if (!event.shiftKey && key === "d") return "addTransition";
      if (event.shiftKey && key === "p") return "toggleProxy";
    }
    if (mod && event.shiftKey && !event.altKey && key === "l") return "toggleLinkedSelection";
    if (mod && !event.shiftKey && !event.altKey && key === "'") return "toggleSafeMargins";
    if (!mod && event.altKey && !event.shiftKey) {
      if (key === "i") return "clearIn";
      if (key === "o") return "clearOut";
      if (key === "x") return "clearInOut";
      if (key === "f") return "freezeFrame";
      if (key === "k") return "toggleKeyframe";
      if (key === "m") return "addSectionCards";
      if (key === "]") return "markAgentChangesReviewed";
    }
    if (!mod && !event.altKey && event.shiftKey) {
      if (key === "j") return "previousKeyframe";
      if (key === "k") return "nextKeyframe";
      if (key === "r") return "toggleRipple";
      if (key === "c") return "addComment";
    }
  }
  if (keymap === "premiere" && mod && event.altKey && !event.shiftKey) {
    if (key === "v") return "addVideoTrack";
    if (key === "a") return "addAudioTrack";
  }
  if (mod && !event.altKey) {
    if (key === "z") return event.shiftKey ? "redo" : "undo";
    if (key === "y") return "redo";
    if (keymap === "premiere") {
      if (key === "a" && event.shiftKey) return "selectForward";
      if (key === "m" && event.shiftKey) return "previousMarker";
      if (key === "l" && !event.shiftKey) return "toggleLink";
      if (key === "=" || key === "+") return "zoomIn";
      if (key === "-" && !event.shiftKey) return "zoomOut";
    }
    if (!event.shiftKey) {
      if (key === "c") return "copy";
      if (key === "v") return "paste";
      if (key === "a") return "selectAll";
      if (key === "b" || key === "k") return "split";
    }
  }
  if (keymap === "premiere" && !mod && event.altKey && !event.shiftKey) {
    if (key === "delete" || key === "backspace") return "rippleRemove";
    if (key === "arrowleft") return "nudgeLeft";
    if (key === "arrowright") return "nudgeRight";
  }
  if (mod || event.altKey) return null;
  if (key === "delete" || key === "backspace") return event.shiftKey ? "rippleRemove" : "remove";
  if (key === "escape") return "clear";
  if (keymap === "minimal") return null;
  if (event.shiftKey) {
    if (key === "m") return "nextMarker";
    if (key === "z") return "zoomToFit";
    if (!["arrowleft", "arrowright", ",", ".", "<", ">", "=", "+"].includes(key)) return null;
  }
  const bindings: Record<string, Shortcut> = {
    " ": "play",
    arrowleft: "back",
    arrowright: "forward",
    arrowup: "previous",
    arrowdown: "next",
    home: "home",
    end: "end",
    "=": "zoomIn",
    "+": "zoomIn",
    "-": "zoomOut",
    "\\": "zoomToFit",
    ",": "nudgeLeft",
    ".": "nudgeRight",
    "<": "nudgeLeft",
    ">": "nudgeRight",
    i: "markIn",
    o: "markOut",
    x: "markClip",
    a: "selectForward",
    m: "addMarker",
    q: "rippleTrimStart",
    w: "rippleTrimEnd",
    s: "toggleSnapping",
    j: "shuttleReverse",
    k: "shuttleStop",
    l: "shuttleForward",
    ";": "liftInOut",
    "'": "extractInOut",
    "1": "layoutFull",
    "2": "layoutPipRight",
    "3": "layoutPipLeft",
    "4": "layoutSplit",
    v: "toolSelect",
    c: "toolBlade",
    b: "toolRippleTrim",
    n: "toolRoll",
    y: "toolSlip",
    u: "toolSlide",
    t: "toggleTranscriptLane",
    "[": "previousAgentChange",
    "]": "nextAgentChange",
  };
  return bindings[key] ?? null;
}
export function workspaceShortcut(event: ShortcutEvent): "save" | "open" | "export" | null {
  if (
    event.defaultPrevented ||
    event.isComposing ||
    event.altKey ||
    event.shiftKey ||
    !(event.ctrlKey || event.metaKey)
  )
    return null;
  switch (event.key.toLowerCase()) {
    case "s":
      return "save";
    case "o":
      return "open";
    case "e":
      return "export";
    default:
      return null;
  }
}
export function protectsEditing(target: EventTarget | null) {
  if (
    typeof document !== "undefined" &&
    document.querySelector(
      '[role="dialog"]:not([hidden]):not([data-ending-style]),[role="alertdialog"]:not([hidden]):not([data-ending-style])',
    )
  )
    return true;
  return (
    target instanceof HTMLElement &&
    Boolean(
      target.closest(
        'input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="dialog"],[role="menu"]',
      ),
    )
  );
}
export function ownsKey(target: EventTarget | null, action: Shortcut) {
  const element = target as Pick<Element, "closest"> | null;
  if (typeof element?.closest !== "function") return false;
  if (action === "play")
    return Boolean(element.closest("button,a,summary,[role=tab],[role=slider]"));
  return (
    ["back", "forward", "backFive", "forwardFive", "previous", "next", "home", "end"].includes(
      action,
    ) && Boolean(element.closest('[role="tablist"],[role="slider"],[role="tab"]'))
  );
}
