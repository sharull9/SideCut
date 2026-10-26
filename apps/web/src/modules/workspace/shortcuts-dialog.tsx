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
import { useEditorView, useEditorSession } from "./editor-session";
import { protectsEditing, parseKeymap } from "./keyboard";
import { Input } from "@sidecut/ui/components/input";
import { FieldLabel } from "@sidecut/ui/components/field";

type Row = { label: string; keys: string[][]; premiereOnly?: boolean };

const GROUPS: { title: string; rows: Row[] }[] = [
  {
    title: "Project",
    rows: [
      { label: "Save on this device", keys: [["Mod", "S"]] },
      { label: "Open project", keys: [["Mod", "O"]] },
      { label: "Export", keys: [["Mod", "E"]] },
    ],
  },
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
      {
        label: "Previous / next marker",
        keys: [
          ["Mod", "Shift", "M"],
          ["Shift", "M"],
        ],
        premiereOnly: true,
      },
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
      { label: "Ripple trim start / end to playhead", keys: [["Q"], ["W"]], premiereOnly: true },
      { label: "Nudge selection", keys: [[","], ["."]], premiereOnly: true },
      { label: "Link / unlink selection", keys: [["Mod", "L"]], premiereOnly: true },
      { label: "Add marker at playhead", keys: [["M"]], premiereOnly: true },
      {
        label: "Add video / audio track",
        keys: [
          ["Mod", "Alt", "V"],
          ["Mod", "Alt", "A"],
        ],
        premiereOnly: true,
      },
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
      {
        label: "Select clips after playhead",
        keys: [["A"], ["Mod", "Shift", "A"]],
        premiereOnly: true,
      },
      { label: "Clear selection and range", keys: [["Esc"]] },
      { label: "Copy", keys: [["Mod", "C"]] },
      { label: "Paste at playhead", keys: [["Mod", "V"]] },
    ],
  },
  {
    title: "Range",
    rows: [
      { label: "Mark in / out", keys: [["I"], ["O"]], premiereOnly: true },
      { label: "Mark targeted clip at playhead", keys: [["X"]], premiereOnly: true },
    ],
  },
  {
    title: "Zoom",
    rows: [
      { label: "Zoom in / out", keys: [["+"], ["-"]], premiereOnly: true },
      { label: "Fit timeline", keys: [["Shift", "Z"], ["\\"]], premiereOnly: true },
      { label: "Toggle snapping", keys: [["S"]], premiereOnly: true },
    ],
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
  const { editor } = useEditorSession();
  const keymap = useEditorView((s) => s.keymap);
  const overrides = useEditorView((s) => s.keymapOverrides);
  const [error, setError] = useState<string | null>(null);
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
        <FieldLabel htmlFor="custom-keymap">Import keyboard overrides (JSON)</FieldLabel>
        <Input
          id="custom-keymap"
          type="file"
          accept=".json,application/json"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            setError(null);
            void (async () => {
              if (file.size > 64 * 1024)
                throw new Error("Keymap files must be smaller than 64 KiB.");
              editor.setState({ keymapOverrides: parseKeymap(JSON.parse(await file.text())) });
            })().catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
          }}
        />
        <p className="editor-hint">
          Bindings override the selected layout. Set a binding to null to disable it.
        </p>
        {Object.keys(overrides).length > 0 && (
          <Button variant="outline" onClick={() => editor.setState({ keymapOverrides: {} })}>
            Reset {Object.keys(overrides).length} custom bindings
          </Button>
        )}
        {error && <p role="alert">{error}</p>}
        <div className="editor-shortcuts">
          <section>
            <h3>Transport and tools</h3>
            <p>
              J / K / L: reverse, stop, forward (repeat for faster shuttle). V: select · C: blade ·
              B: ripple trim · N: roll · Y: slip · U: slide.
            </p>
            <p>
              Alt I / O / X: clear in, out, both · ;: lift range · ': extract range · Alt F: freeze
              · Alt K: toggle keyframes · Shift J / K: previous / next keyframe · 1–4: layouts.
            </p>
          </section>
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
