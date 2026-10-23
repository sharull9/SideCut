import { useState } from "react";
import { Button } from "@sidecut/ui/components/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@sidecut/ui/components/field";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@sidecut/ui/components/dialog";
import { formatOf, isHiddenIn, PORTRAIT, type PortraitSlot } from "@sidecut/core/formats";
import { planShort, type ShortPlan } from "@sidecut/core/short";
import { useEditorSession, useEditorView } from "./editor-session";

const PRESETS = [PORTRAIT, { id: "square", name: "Square (1:1)", width: 1080, height: 1080 }];

export function FormatsDialog() {
  const { session, snapshot, editor } = useEditorSession();
  const format = useEditorView((s) => s.format);
  const selected = useEditorView((s) => s.selected);
  const [open, setOpen] = useState(false);
  const [preset, setPreset] = useState(PORTRAIT.id);
  const [plan, setPlan] = useState<ShortPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const project = snapshot.project;
  const output = formatOf(project, format);
  const disabled = snapshot.busy || snapshot.readOnly;
  const clips = project.videoTracks.flatMap((t) => t.clips).filter((c) => selected.includes(c.id));
  const locked = project.videoTracks.some(
    (t) => t.locked && t.clips.some((c) => selected.includes(c.id)),
  );
  const apply = (label: string, commands: unknown[], revision = snapshot.revision) => {
    setError(null);
    setDone(null);
    try {
      const result = session.apply({ label, commands, expectedRevision: revision });
      setPlan(null);
      setDone([label, ...result.warnings].join(". "));
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return false;
    }
  };
  const layout = (slot: PortraitSlot) =>
    output &&
    apply(`Place clips in ${output.name}`, [
      { setFormatLayout: { clipIDs: clips.map((c) => c.id), format: output.id, slot } },
    ]);
  const hidden = (value: boolean | null) =>
    output &&
    apply(
      value === null
        ? "Reset format overrides"
        : value
          ? "Hide clips in format"
          : "Show clips in format",
      clips.map((clip) => ({
        updateClip: {
          clipID: clip.id,
          patch: {
            video: { formatOverrides: { [output.id]: value === null ? null : { hidden: value } } },
          },
        },
      })),
    );
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        setError(null);
        setDone(null);
        setPlan(null);
      }}
    >
      <DialogTrigger render={<Button size="xs" variant="ghost" />}>Formats</DialogTrigger>
      <DialogContent className="dark max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Output formats</DialogTitle>
          <DialogDescription>
            Preview another canvas, arrange selected clips for it, or make it the main canvas. Each
            edit can be undone.
          </DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="format-preview">Preview</FieldLabel>
            <select
              id="format-preview"
              value={output?.id ?? ""}
              onChange={(e) => editor.getState().setFormat(e.target.value || null)}
            >
              <option value="">
                Main canvas · {project.settings.width} × {project.settings.height}
              </option>
              {project.settings.alternateFormats.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name} · {f.width} × {f.height}
                </option>
              ))}
            </select>
          </Field>
          <Field>
            <FieldLabel htmlFor="format-add">Add format</FieldLabel>
            <select
              id="format-add"
              value={preset}
              disabled={disabled}
              onChange={(e) => setPreset(e.target.value)}
            >
              {PRESETS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </Field>
          <Button
            size="sm"
            variant="outline"
            disabled={disabled || project.settings.alternateFormats.some((f) => f.id === preset)}
            onClick={() => {
              const next = PRESETS.find((f) => f.id === preset)!;
              if (
                apply("Add output format", [
                  {
                    updateSettings: {
                      patch: { alternateFormats: [...project.settings.alternateFormats, next] },
                    },
                  },
                ])
              )
                editor.getState().setFormat(next.id);
            }}
          >
            Add format
          </Button>
          {output && (
            <>
              <FieldDescription>
                {clips.length} selected video clips. Placement fills the chosen part of the canvas
                and resets its crop.
              </FieldDescription>
              <div className="editor-clip-edit-actions">
                {(["top", "bottom", "full"] as const).map((slot) => (
                  <Button
                    key={slot}
                    size="sm"
                    variant="outline"
                    disabled={disabled || locked || !clips.length}
                    onClick={() => layout(slot)}
                  >
                    {slot === "full" ? "Full frame" : slot === "top" ? "Top half" : "Bottom half"}
                  </Button>
                ))}
              </div>
              <div className="editor-clip-edit-actions">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={disabled || locked || !clips.length}
                  onClick={() => hidden(!clips.every((c) => isHiddenIn(c, output.id)))}
                >
                  {clips.length > 0 && clips.every((c) => isHiddenIn(c, output.id))
                    ? "Show selected"
                    : "Hide selected"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={disabled || locked || !clips.length}
                  onClick={() => hidden(null)}
                >
                  Reset selected overrides
                </Button>
              </div>
              <FieldDescription>
                Adopting {output.name} changes the main canvas, applies its overrides, and removes
                this alternate. Hidden clips become disabled. Incompatible pan keyframes are removed
                with a warning.
              </FieldDescription>
              <Button
                size="sm"
                disabled={disabled}
                onClick={() => {
                  if (apply(`Adopt ${output.name}`, [{ adoptFormat: { format: output.id } }]))
                    editor.getState().setFormat(null);
                }}
              >
                Make {output.name} the main canvas
              </Button>
            </>
          )}
          <Button
            size="sm"
            variant="outline"
            disabled={disabled}
            onClick={() => {
              setError(null);
              setDone(null);
              try {
                setPlan(planShort({ project, revision: snapshot.revision }));
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : String(cause));
              }
            }}
          >
            Preview short layout
          </Button>
          {plan && (
            <>
              <p role="status">
                {plan.format.name}:{" "}
                {Object.entries(plan.placed)
                  .map(([slot, count]) => `${count} ${slot}`)
                  .join(", ") || "no media clips to arrange"}
                . {plan.warnings.join(" ")}
              </p>
              {plan.revision !== snapshot.revision && (
                <FieldDescription>
                  The project changed. Preview the layout again before applying.
                </FieldDescription>
              )}
              <Button
                size="sm"
                disabled={disabled || plan.revision !== snapshot.revision || !plan.commands.length}
                onClick={() => {
                  if (apply(plan.label, plan.commands, plan.revision))
                    editor.getState().setFormat(plan.format.id);
                }}
              >
                Apply short layout
              </Button>
            </>
          )}
          {done && <p role="status">{done}</p>}
          {error && <FieldError role="alert">{error}</FieldError>}
        </FieldGroup>
      </DialogContent>
    </Dialog>
  );
}
