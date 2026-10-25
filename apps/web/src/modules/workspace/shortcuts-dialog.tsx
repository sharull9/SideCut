import { useEffect, useState } from "react";
import { RiKeyboardBoxLine } from "@remixicon/react";
import { Button } from "@sidecut/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@sidecut/ui/components/dialog";
import { useEditorView } from "./editor-session";
import { protectsEditing } from "./keyboard";

type Row = { label: string; keys: string[][]; premiereOnly?: boolean };

const GROUPS: { title: string; rows: Row[] }[] = [
  {
    title: "Playback & navigation",
    rows: [
      { label: "Play / pause", keys: [["Space"]], premiereOnly: true },
      { label: "Step one frame", keys: [["←"], ["→"]], premiereOnly: true },
      {
        label: "Step five frames",
        keys: [
          ["Shift", "←"],
          ["Shift", "→"],
        ],
        premiereOnly: true,
      },
      { label: "Previous / next edit", keys: [["↑"], ["↓"]], premiereOnly: true },
      { label: "Start / end of sequence", keys: [["Home"], ["End"]], premiereOnly: true },
    ],
  },
  {
    title: "Editing",
    rows: [
      {
        label: "Split at playhead",
        keys: [
          ["Mod", "B"],
          ["Mod", "K"],
        ],
      },
      { label: "Lift selection", keys: [["Delete"]] },
      { label: "Ripple delete", keys: [["Shift", "Delete"]] },
      { label: "Nudge selection", keys: [[","], ["."]], premiereOnly: true },
      { label: "Undo", keys: [["Mod", "Z"]] },
      {
        label: "Redo",
        keys: [
          ["Mod", "Shift", "Z"],
          ["Mod", "Y"],
        ],
      },
    ],
  },
  {
    title: "Selection & clipboard",
    rows: [
      { label: "Select all", keys: [["Mod", "A"]] },
      { label: "Clear selection and range", keys: [["Esc"]] },
      { label: "Copy", keys: [["Mod", "C"]] },
      { label: "Paste at playhead", keys: [["Mod", "V"]] },
    ],
  },
  {
    title: "Range",
    rows: [{ label: "Mark in / out", keys: [["I"], ["O"]], premiereOnly: true }],
  },
  {
    title: "Zoom",
    rows: [{ label: "Zoom in / out", keys: [["+"], ["-"]], premiereOnly: true }],
  },
];

function isApple() {
  if (typeof navigator === "undefined") return false;
  const platform =
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ??
    navigator.platform;
  return /mac|iphone|ipad/i.test(platform);
}

export function ShortcutsDialog() {
  const keymap = useEditorView((s) => s.keymap);
  const [open, setOpen] = useState(false);
  const apple = isApple();
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key !== "?" || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.defaultPrevented || event.isComposing || protectsEditing(event.target)) return;
      event.preventDefault();
      setOpen(true);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  const label = (key: string) => (key === "Mod" ? (apple ? "⌘" : "Ctrl") : key);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="Keyboard shortcuts"
        title="Keyboard shortcuts (?)"
        onClick={() => setOpen(true)}
      >
        <RiKeyboardBoxLine aria-hidden="true" />
      </Button>
      <DialogContent className="dark editor-dialog">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            {keymap === "premiere"
              ? "Premiere subset keymap is active."
              : "Editing only keymap is active. Dimmed shortcuts need the Premiere subset keymap."}
          </DialogDescription>
        </DialogHeader>
        <div className="editor-shortcuts">
          {GROUPS.map((group) => (
            <section key={group.title}>
              <h3>{group.title}</h3>
              <dl>
                {group.rows.map((row) => (
                  <ShortcutRow
                    key={row.label}
                    row={row}
                    inactive={Boolean(row.premiereOnly) && keymap !== "premiere"}
                    label={label}
                  />
                ))}
              </dl>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ShortcutRow({
  row,
  inactive,
  label,
}: {
  row: Row;
  inactive: boolean;
  label: (key: string) => string;
}) {
  return (
    <>
      <dt data-inactive={inactive}>
        {row.label}
        {row.premiereOnly && <small> · Premiere subset</small>}
      </dt>
      <dd>
        {row.keys.map((combo, index) => (
          <span key={combo.join("+")}>
            {index > 0 && <small> or </small>}
            {combo.map((key) => (
              <kbd key={key}>{label(key)}</kbd>
            ))}
          </span>
        ))}
      </dd>
    </>
  );
}
