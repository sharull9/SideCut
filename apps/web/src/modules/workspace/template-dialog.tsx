import { useState } from "react";
import { Button } from "@sidecut/ui/components/button";
import { Input } from "@sidecut/ui/components/input";
import { Field, FieldError, FieldGroup, FieldLabel } from "@sidecut/ui/components/field";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@sidecut/ui/components/dialog";
import { BUILT_IN_TEMPLATES } from "@sidecut/core/templates";
import { RiLayoutMasonryLine } from "@remixicon/react";
import { useEditorSession } from "./editor-session";
import { ToolTip } from "./tool-tip";
import "./dialogs.css";

export function TemplateDialog() {
  const { session, snapshot, editor } = useEditorSession();
  const [open, setOpen] = useState(false),
    [id, setID] = useState<string>(BUILT_IN_TEMPLATES[0].id),
    [mode, setMode] = useState<"overwrite" | "place" | "insert">("overwrite"),
    [values, setValues] = useState<Record<string, string>>({}),
    [error, setError] = useState<string | null>(null);
  const template = BUILT_IN_TEMPLATES.find((t) => t.id === id)!;
  const disabled = snapshot.busy || snapshot.readOnly;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <ToolTip label="Insert template">
        <DialogTrigger
          render={
            <Button
              size="xs"
              variant="ghost"
              className="editor-tool-button"
              aria-label="+ Template"
              disabled={disabled}
            />
          }
        >
          <RiLayoutMasonryLine data-icon="inline-start" aria-hidden="true" />
          <span className="editor-tool-text" aria-hidden="true">
            Template
          </span>
        </DialogTrigger>
      </ToolTip>
      <DialogContent className="dark editor-dialog editor-dialog-form">
        <DialogHeader>
          <DialogTitle>Insert template</DialogTitle>
          <DialogDescription>
            Starts at the playhead. Clips go on tracks by name (made if missing), get new IDs, are
            linked together and tagged with the template.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            try {
              const result = session.apply({
                label: `Add ${template.name.toLowerCase()}`,
                expectedRevision: snapshot.revision,
                commands: [
                  {
                    insertTemplate: {
                      template,
                      at: editor.getState().playhead.seconds,
                      values: Object.fromEntries(
                        template.fields.map((f) => [
                          f.key,
                          values[`${id}:${f.key}`] ?? f.defaultValue,
                        ]),
                      ),
                      mode,
                    },
                  },
                ],
              });
              const first = result.createdIDs.find((created) => created.startsWith("clip_"));
              if (first) editor.getState().select(first);
              setOpen(false);
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : String(cause));
            }
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="template-id">Template</FieldLabel>
              <select
                id="template-id"
                value={id}
                disabled={disabled}
                onChange={(e) => setID(e.target.value)}
              >
                {BUILT_IN_TEMPLATES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} · {t.duration} s
                  </option>
                ))}
              </select>
            </Field>
            {template.fields.map((field) => (
              <Field key={field.key}>
                <FieldLabel htmlFor={`template-${field.key}`}>{field.label}</FieldLabel>
                <Input
                  id={`template-${field.key}`}
                  value={values[`${id}:${field.key}`] ?? field.defaultValue}
                  disabled={disabled}
                  onChange={(e) =>
                    setValues((v) => ({ ...v, [`${id}:${field.key}`]: e.target.value }))
                  }
                />
              </Field>
            ))}
            <Field>
              <FieldLabel htmlFor="template-mode">Placement</FieldLabel>
              <select
                id="template-mode"
                value={mode}
                disabled={disabled}
                onChange={(e) => setMode(e.target.value as typeof mode)}
              >
                <option value="overwrite">Overwrite what is there</option>
                <option value="place">Only into free space</option>
                <option value="insert">Insert, pushing later clips</option>
              </select>
            </Field>
            {error && <FieldError role="alert">{error}</FieldError>}
            <Button type="submit" disabled={disabled}>
              Insert {template.name.toLowerCase()}
            </Button>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  );
}
