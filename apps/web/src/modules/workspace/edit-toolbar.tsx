import { useState, useEffect } from "react";
import { Button } from "@sidecut/ui/components/button";
import { Input } from "@sidecut/ui/components/input";
import { FieldLabel } from "@sidecut/ui/components/field";
import {
  RiArrowRightLine,
  RiDeleteBack2Line,
  RiDeleteBin2Line,
  RiEjectLine,
  RiKeyboardLine,
  RiLinksLine,
  RiLinkUnlinkM,
  RiMergeCellsHorizontal,
  RiRulerLine,
  RiScissorsCutLine,
} from "@remixicon/react";
import { useEditorSession, useEditorView } from "./editor-session";
import { useEditActions } from "./edit-actions";
import { TimeEditsDialog } from "./time-edits-dialog";
import { SpeechToolsDialog } from "./speech-tools";
import { ShortcutsDialog } from "./shortcuts-dialog";
import { MOD, ToolTip } from "./tool-tip";
import "./toolbar.css";

export function EditToolbar({ run }: { run: (action: () => unknown) => void }) {
  const { session, editor } = useEditorSession();
  const keymap = useEditorView((s) => s.keymap),
    range = useEditorView((s) => s.range);
  const selected = useEditorView((s) => s.selected);
  const actions = useEditActions(run);
  const [start, setStart] = useState("0"),
    [finish, setFinish] = useState("1");
  useEffect(() => {
    if (range) {
      setStart(String(range.from));
      setFinish(String(range.to));
    }
  }, [range]);
  return (
    <div className="editor-edit-toolbar">
      <div className="editor-toolbar-group">
        <ToolTip label="Keyboard layout">
          <label className="editor-keymap">
            <RiKeyboardLine className="editor-keymap-icon" size={14} aria-hidden="true" />
            <select
              aria-label="Keyboard layout"
              value={keymap}
              onChange={(event) =>
                editor
                  .getState()
                  .setKeymap(event.target.value === "minimal" ? "minimal" : "premiere")
              }
            >
              <option value="premiere">Premiere subset</option>
              <option value="minimal">Editing only</option>
            </select>
          </label>
        </ToolTip>
        <ShortcutsDialog />
      </div>
      <div className="editor-toolbar-group">
        <ToolTip label="Split at playhead" shortcut={`${MOD} K`}>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Split"
            disabled={actions.disabled}
            onClick={actions.split}
          >
            <RiScissorsCutLine aria-hidden="true" />
          </Button>
        </ToolTip>
        <ToolTip label="Lift selection" shortcut="Delete">
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Lift"
            disabled={actions.disabled || !selected.length}
            onClick={() => actions.remove(false)}
          >
            <RiEjectLine aria-hidden="true" />
          </Button>
        </ToolTip>
        <ToolTip label="Ripple delete selection" shortcut="Shift Delete">
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Ripple delete"
            disabled={actions.disabled || !selected.length}
            onClick={() => actions.remove(true)}
          >
            <RiDeleteBack2Line aria-hidden="true" />
          </Button>
        </ToolTip>
        <ToolTip label="Link selected clips">
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Link"
            disabled={actions.disabled || selected.length < 2}
            onClick={actions.link}
          >
            <RiLinksLine aria-hidden="true" />
          </Button>
        </ToolTip>
        <ToolTip label="Unlink selected clips">
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Unlink"
            disabled={actions.disabled || !selected.length}
            onClick={actions.unlink}
          >
            <RiLinkUnlinkM aria-hidden="true" />
          </Button>
        </ToolTip>
      </div>
      <div className="editor-toolbar-group">
        <TimeEditsDialog />
        <SpeechToolsDialog />
        <ToolTip label="Join through-edits">
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Join through-edits"
            disabled={actions.disabled}
            onClick={() =>
              run(() =>
                session.apply({
                  label: "Join through-edits",
                  commands: [{ joinThroughEdits: {} }],
                }),
              )
            }
          >
            <RiMergeCellsHorizontal aria-hidden="true" />
          </Button>
        </ToolTip>
      </div>
      <form
        className="editor-range-form"
        onSubmit={(event) => {
          event.preventDefault();
          run(() => {
            const a = Number(start),
              b = Number(finish);
            if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a)
              throw new Error("Range end must follow its start.");
            return session.apply({
              label: "Ripple delete time range",
              commands: [{ rippleDeleteRange: { range: { start: a, duration: b - a } } }],
            });
          });
        }}
      >
        <ToolTip label="Time range in seconds">
          <div className="editor-range-fields" role="group" aria-label="Ripple range">
            <RiRulerLine size={14} aria-hidden="true" />
            <FieldLabel htmlFor="ripple-start" className="sr-only">
              Range
            </FieldLabel>
            <Input
              id="ripple-start"
              aria-label="Ripple range start seconds"
              type="number"
              min="0"
              step="any"
              required
              value={start}
              onChange={(e) => setStart(e.target.value)}
              disabled={actions.disabled}
            />
            <RiArrowRightLine size={12} aria-hidden="true" />
            <FieldLabel htmlFor="ripple-end" className="sr-only">
              to
            </FieldLabel>
            <Input
              id="ripple-end"
              aria-label="Ripple range end seconds"
              type="number"
              min="0"
              step="any"
              required
              value={finish}
              onChange={(e) => setFinish(e.target.value)}
              disabled={actions.disabled}
            />
          </div>
        </ToolTip>
        <ToolTip label="Delete range">
          <Button
            type="submit"
            variant="outline"
            size="icon-xs"
            aria-label="Delete range"
            disabled={actions.disabled}
          >
            <RiDeleteBin2Line aria-hidden="true" />
          </Button>
        </ToolTip>
      </form>
    </div>
  );
}
