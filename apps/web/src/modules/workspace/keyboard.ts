export type Shortcut =
  | "split"
  | "remove"
  | "rippleRemove"
  | "undo"
  | "redo"
  | "copy"
  | "paste"
  | "selectAll"
  | "clear"
  | "play"
  | "back"
  | "forward"
  | "previous"
  | "next"
  | "home"
  | "end"
  | "zoomIn"
  | "zoomOut"
  | "nudgeLeft"
  | "nudgeRight"
  | "markIn"
  | "markOut";
export function shortcut(
  event: Pick<
    KeyboardEvent,
    "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey" | "isComposing" | "defaultPrevented"
  >,
  keymap: "premiere" | "minimal",
): Shortcut | null {
  if (event.defaultPrevented || event.isComposing) return null;
  const key = event.key.toLowerCase(),
    mod = event.ctrlKey || event.metaKey;
  if (mod && !event.altKey) {
    if (key === "z") return event.shiftKey ? "redo" : "undo";
    if (key === "y") return "redo";
    if (!event.shiftKey) {
      if (key === "c") return "copy";
      if (key === "v") return "paste";
      if (key === "a") return "selectAll";
      if (key === "b" || key === "k") return "split";
    }
  }
  if (mod || event.altKey) return null;
  if (key === "delete" || key === "backspace") return event.shiftKey ? "rippleRemove" : "remove";
  if (key === "escape") return "clear";
  if (keymap === "minimal") return null;
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
    ",": "nudgeLeft",
    ".": "nudgeRight",
    i: "markIn",
    o: "markOut",
  };
  return bindings[key] ?? null;
}
export function protectsEditing(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    Boolean(
      target.closest(
        'input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="dialog"],[role="menu"]',
      ),
    )
  );
}
