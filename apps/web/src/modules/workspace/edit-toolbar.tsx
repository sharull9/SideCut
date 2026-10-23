import { useState } from "react";
import { Button } from "@sidecut/ui/components/button";
import { Input } from "@sidecut/ui/components/input";
import { Field, FieldLabel, FieldGroup } from "@sidecut/ui/components/field";
import { useEditorSession, useEditorView } from "./editor-session";
import { useEditActions } from "./edit-actions";
import { TimeEditsDialog } from "./time-edits-dialog";
import { SpeechToolsDialog } from "./speech-tools";

export function EditToolbar({ run }: { run: (action: () => unknown) => void }) {
  const { session } = useEditorSession();
  const selected = useEditorView((s) => s.selected);
  const actions = useEditActions(run);
  const [start, setStart] = useState("0"),
    [finish, setFinish] = useState("1");
  return (
    <div className="editor-edit-toolbar">
      <Button
        variant="ghost"
        size="xs"
        disabled={actions.disabled}
        onClick={actions.split}
        title="Split at playhead (Ctrl/Cmd+K or Ctrl/Cmd+B)"
      >
        Split
      </Button>
      <Button
        variant="ghost"
        size="xs"
        disabled={actions.disabled || !selected.length}
        onClick={() => actions.remove(false)}
        title="Lift selection (Delete)"
      >
        Lift
      </Button>
      <Button
        variant="ghost"
        size="xs"
        disabled={actions.disabled || !selected.length}
        onClick={() => actions.remove(true)}
        title="Ripple delete selection (Shift+Delete)"
      >
        Ripple delete
      </Button>
      <Button
        variant="ghost"
        size="xs"
        disabled={actions.disabled || selected.length < 2}
        onClick={actions.link}
      >
        Link
      </Button>
      <Button
        variant="ghost"
        size="xs"
        disabled={actions.disabled || !selected.length}
        onClick={actions.unlink}
      >
        Unlink
      </Button>
      <TimeEditsDialog />
      <SpeechToolsDialog />
      <Button
        variant="ghost"
        size="xs"
        disabled={actions.disabled}
        onClick={() =>
          run(() =>
            session.apply({ label: "Join through-edits", commands: [{ joinThroughEdits: {} }] }),
          )
        }
      >
        Join through-edits
      </Button>
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
        <FieldGroup>
          <Field orientation="horizontal">
            <FieldLabel htmlFor="ripple-start">Range</FieldLabel>
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
          </Field>
          <Field orientation="horizontal">
            <FieldLabel htmlFor="ripple-end">to</FieldLabel>
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
          </Field>
        </FieldGroup>
        <Button type="submit" variant="outline" size="xs" disabled={actions.disabled}>
          Delete range
        </Button>
      </form>
    </div>
  );
}
