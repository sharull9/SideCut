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
  | "markClip";
type ShortcutEvent = Pick<
  KeyboardEvent,
  "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey" | "isComposing" | "defaultPrevented"
>;
export function shortcut(event: ShortcutEvent, keymap: "premiere" | "minimal"): Shortcut | null {
  if (event.defaultPrevented || event.isComposing) return null;
  const key = event.key.toLowerCase(),
    mod = event.ctrlKey || event.metaKey;
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
    ["back", "forward", "previous", "next", "home", "end"].includes(action) &&
    Boolean(element.closest('[role="tablist"],[role="slider"],[role="tab"]'))
  );
}
