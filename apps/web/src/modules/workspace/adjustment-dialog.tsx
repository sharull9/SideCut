import { useState } from "react";
import { Button } from "@sidecut/ui/components/button";
import { Input } from "@sidecut/ui/components/input";
import { Field, FieldGroup, FieldLabel, FieldError } from "@sidecut/ui/components/field";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@sidecut/ui/components/dialog";
import { RiContrast2Line } from "@remixicon/react";
import { useEditorSession } from "./editor-session";
import { ToolTip } from "./tool-tip";
import "./dialogs.css";
export function AdjustmentDialog() {
  const { session, snapshot, editor } = useEditorSession();
  const [open, setOpen] = useState(false),
    [duration, setDuration] = useState("5"),
    [trackID, setTrackID] = useState("new"),
    [error, setError] = useState<string | null>(null);
  const disabled = snapshot.busy || snapshot.readOnly;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <ToolTip label="Insert adjustment clip">
        <DialogTrigger
          render={
            <Button
              size="xs"
              variant="ghost"
              className="editor-tool-button"
              aria-label="+ Adjustment"
              disabled={disabled}
            />
          }
        >
          <RiContrast2Line data-icon="inline-start" aria-hidden="true" />
          <span className="editor-tool-text" aria-hidden="true">
            Adjustment
          </span>
        </DialogTrigger>
      </ToolTip>
      <DialogContent className="dark editor-dialog editor-dialog-form">
        <DialogHeader>
          <DialogTitle>Insert adjustment clip</DialogTitle>
          <DialogDescription>
            Starts at the playhead. Its effects change the composited picture below its track. Add
            effects in the inspector; opacity blends the adjustment.
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
                label: "Insert adjustment clip",
                expectedRevision: snapshot.revision,
                commands: [
                  ...(trackID === "new"
                    ? [{ addTrack: { kind: "video", id: track, name: "Adjustment" } }]
                    : []),
                  {
                    insertClip: {
                      trackID: track,
                      clip: {
                        id,
                        name: "Adjustment",
                        content: { adjustment: {} },
                        start: editor.getState().playhead.seconds,
                        duration: Number(duration),
                        video: { effects: [] },
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
              <FieldLabel htmlFor="adjustment-track">Video track</FieldLabel>
              <select
                id="adjustment-track"
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
              <FieldLabel htmlFor="adjustment-duration">Adjustment duration (s)</FieldLabel>
              <Input
                id="adjustment-duration"
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
              Insert adjustment
            </Button>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  );
}
