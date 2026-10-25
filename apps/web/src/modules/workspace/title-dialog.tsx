import { useState } from "react";
import { Button } from "@sidecut/ui/components/button";
import { Input } from "@sidecut/ui/components/input";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
  FieldError,
} from "@sidecut/ui/components/field";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@sidecut/ui/components/dialog";
import { TITLE_PRESETS } from "@sidecut/core/text";
import { RiHeading } from "@remixicon/react";
import { useEditorSession } from "./editor-session";
import { ToolTip } from "./tool-tip";
import "./dialogs.css";

export function TitleDialog() {
  const { session, snapshot, editor } = useEditorSession();
  const [open, setOpen] = useState(false),
    [text, setText] = useState("Title"),
    [preset, setPreset] = useState("label"),
    [duration, setDuration] = useState("3"),
    [trackID, setTrackID] = useState("new"),
    [error, setError] = useState<string | null>(null);
  const disabled = snapshot.busy || snapshot.readOnly;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <ToolTip label="Insert title">
        <DialogTrigger
          render={
            <Button
              size="xs"
              variant="ghost"
              className="editor-tool-button"
              aria-label="+ Title"
              disabled={disabled}
            />
          }
        >
          <RiHeading data-icon="inline-start" aria-hidden="true" />
          <span className="editor-tool-text" aria-hidden="true">
            Title
          </span>
        </DialogTrigger>
      </ToolTip>
      <DialogContent className="dark editor-dialog editor-dialog-form">
        <DialogHeader>
          <DialogTitle>Insert title</DialogTitle>
          <DialogDescription>
            Starts at the playhead. Use a line break for two-line presets. Edit text, style and
            animation in the inspector.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            try {
              const id = `clip_${crypto.randomUUID()}`,
                track = trackID === "new" ? `trk_${crypto.randomUUID()}` : trackID;
              session.apply({
                label: "Insert title",
                expectedRevision: snapshot.revision,
                commands: [
                  ...(trackID === "new"
                    ? [{ addTrack: { kind: "video", id: track, name: "Titles" } }]
                    : []),
                  {
                    insertClip: {
                      trackID: track,
                      clip: {
                        id,
                        name: text.split("\n")[0] || "Title",
                        content: { text: { text, ...(preset ? { preset } : {}) } },
                        start: editor.getState().playhead.seconds,
                        duration: Number(duration),
                      },
                    },
                  },
                ],
              });
              editor.getState().select(id);
              setOpen(false);
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : String(cause));
            }
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="title-text">Text</FieldLabel>
              <textarea
                id="title-text"
                className="editor-text-area"
                rows={2}
                required
                value={text}
                onChange={(e) => setText(e.target.value)}
                disabled={disabled}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="title-preset">Preset</FieldLabel>
              <select
                id="title-preset"
                value={preset}
                disabled={disabled}
                onChange={(e) => setPreset(e.target.value)}
              >
                <option value="">None</option>
                {TITLE_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <FieldDescription>
                {TITLE_PRESETS.find((p) => p.id === preset)?.summary ??
                  "Default style: 64 pt, weight 800, white, centered."}
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="title-track">Video track</FieldLabel>
              <select
                id="title-track"
                disabled={disabled}
                value={trackID}
                onChange={(e) => setTrackID(e.target.value)}
              >
                <option value="new">New top track</option>
                {snapshot.project.videoTracks
                  .filter((t) => !t.locked)
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
              </select>
            </Field>
            <Field>
              <FieldLabel htmlFor="title-duration">Duration (s)</FieldLabel>
              <Input
                id="title-duration"
                type="number"
                min="0.000021"
                step="any"
                required
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                disabled={disabled}
              />
            </Field>
            {error && <FieldError role="alert">{error}</FieldError>}
            <Button type="submit" disabled={disabled}>
              Insert title
            </Button>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  );
}
