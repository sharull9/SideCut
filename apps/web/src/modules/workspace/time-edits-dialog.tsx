import { useState } from "react";
import { Button } from "@sidecut/ui/components/button";
import { Input } from "@sidecut/ui/components/input";
import { Field, FieldGroup, FieldLabel, FieldError } from "@sidecut/ui/components/field";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@sidecut/ui/components/dialog";
import { useEditorSession, useEditorView } from "./editor-session";

export function TimeEditsDialog() {
  const { session, snapshot, editor } = useEditorSession();
  const selected = useEditorView((s) => s.selected);
  const [open, setOpen] = useState(false),
    [at, setAt] = useState("0"),
    [duration, setDuration] = useState("1"),
    [error, setError] = useState<string | null>(null);
  const [ranges, setRanges] = useState([{ id: "initial", start: "0", end: "1" }]);
  const tracks = [...snapshot.project.videoTracks, ...snapshot.project.audioTracks];
  const track =
    tracks.find((t) => t.clips.some((c) => selected.includes(c.id))) ??
    tracks.find((t) => t.targeted && !t.locked);
  const disabled = snapshot.readOnly || snapshot.busy;
  const apply = (operation: () => void) => {
    setError(null);
    try {
      operation();
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const number = (value: string) => {
    if (!value.trim() || !Number.isFinite(Number(value)))
      throw new Error("Enter finite times in seconds.");
    return Number(value);
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (value) {
          setAt(String(editor.getState().playhead.seconds));
          setError(null);
        }
        setOpen(value);
      }}
    >
      <DialogTrigger render={<Button variant="outline" size="xs" disabled={disabled} />}>
        Time edits
      </DialogTrigger>
      <DialogContent className="dark max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Time edits</DialogTitle>
          <DialogDescription>
            Cut and insert time use the sequence's cut, follow, off, and locked track settings.
            Ranges use the timeline before the edit.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            apply(() => {
              session.apply({
                label: "Insert time",
                expectedRevision: snapshot.revision,
                commands: [{ insertTime: { at: number(at), duration: number(duration) } }],
              });
            });
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="insert-at">Insert at (s)</FieldLabel>
              <Input
                id="insert-at"
                type="number"
                min="0"
                step="any"
                required
                disabled={disabled}
                value={at}
                onChange={(e) => setAt(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="insert-duration">Duration to insert (s)</FieldLabel>
              <Input
                id="insert-duration"
                type="number"
                min="0"
                step="any"
                required
                disabled={disabled}
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
              />
            </Field>
            <Button type="submit" variant="outline" size="sm" disabled={disabled}>
              Insert time
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled || !track}
              onClick={() =>
                apply(() => {
                  if (track)
                    session.apply({
                      label: "Close gap",
                      expectedRevision: snapshot.revision,
                      commands: [{ closeGap: { trackID: track.id, at: number(at) } }],
                    });
                })
              }
            >
              Close gap on {track?.name ?? "selected track"}
            </Button>
          </FieldGroup>
        </form>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            apply(() => {
              session.apply({
                label: "Cut ranges",
                expectedRevision: snapshot.revision,
                commands: [
                  {
                    cutRanges: {
                      ranges: ranges.map((r) => ({
                        start: number(r.start),
                        duration: number(r.end) - number(r.start),
                      })),
                    },
                  },
                ],
              });
            });
          }}
        >
          <FieldGroup>
            {ranges.map((range, index) => (
              <FieldGroup key={range.id} className="editor-time-range-row">
                {(["start", "end"] as const).map((edge) => (
                  <Field key={edge}>
                    <FieldLabel htmlFor={`range-${range.id}-${edge}`}>
                      Range {index + 1} {edge} (s)
                    </FieldLabel>
                    <Input
                      id={`range-${range.id}-${edge}`}
                      type="number"
                      min="0"
                      step="any"
                      required
                      disabled={disabled}
                      value={range[edge]}
                      onChange={(e) =>
                        setRanges((all) =>
                          all.map((r) =>
                            r.id === range.id ? { ...r, [edge]: e.target.value } : r,
                          ),
                        )
                      }
                    />
                  </Field>
                ))}
                {ranges.length > 1 && (
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    aria-label={`Remove range ${index + 1}`}
                    onClick={() => setRanges((all) => all.filter((r) => r.id !== range.id))}
                  >
                    Remove
                  </Button>
                )}
              </FieldGroup>
            ))}
            <div className="editor-clip-edit-actions">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={disabled}
                onClick={() =>
                  setRanges((all) => [
                    ...all,
                    {
                      id: crypto.randomUUID(),
                      start: all.at(-1)?.end ?? "0",
                      end: String(Number(all.at(-1)?.end ?? "0") + 1),
                    },
                  ])
                }
              >
                Add range
              </Button>
              <Button type="submit" variant="outline" size="sm" disabled={disabled}>
                Cut listed ranges
              </Button>
            </div>
          </FieldGroup>
        </form>
        {error && <FieldError role="alert">{error}</FieldError>}
      </DialogContent>
    </Dialog>
  );
}
