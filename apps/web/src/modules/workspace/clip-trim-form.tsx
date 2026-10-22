import { useState } from "react";
import type { Clip } from "@sidecut/contracts/project";
import { Button } from "@sidecut/ui/components/button";
import { Input } from "@sidecut/ui/components/input";
import { Field, FieldGroup, FieldLabel, FieldError } from "@sidecut/ui/components/field";
import { useEditorSession } from "./editor-session";
export function ClipTrimForm({ clip }: { clip: Clip }) {
  const { session, snapshot } = useEditorSession();
  const [start, setStart] = useState(String(clip.start.seconds)),
    [end, setEnd] = useState(String(clip.start.seconds + clip.duration.seconds)),
    [error, setError] = useState<string | null>(null);
  const track = [...snapshot.project.videoTracks, ...snapshot.project.audioTracks].find((t) =>
    t.clips.some((c) => c.id === clip.id),
  );
  const disabled = snapshot.readOnly || snapshot.busy || track?.locked;
  return (
    <form
      className="editor-trim-form"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        try {
          const a = Number(start),
            b = Number(end);
          if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a)
            throw new Error("End must follow start.");
          const commands = [];
          const head = { trim: { clipID: clip.id, edge: "start", to: a } },
            tail = { trim: { clipID: clip.id, edge: "end", to: b } };
          if (b > clip.start.seconds + clip.duration.seconds) {
            commands.push(tail, head);
          } else commands.push(head, tail);
          session.apply({
            label: "Trim source range",
            expectedRevision: snapshot.revision,
            commands,
          });
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      }}
    >
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="trim-start">Timeline start (s)</FieldLabel>
          <Input
            id="trim-start"
            type="number"
            min="0"
            step="any"
            required
            disabled={disabled}
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="trim-end">Timeline end (s)</FieldLabel>
          <Input
            id="trim-end"
            type="number"
            min="0"
            step="any"
            required
            disabled={disabled}
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </Field>
        {error && <FieldError>{error}</FieldError>}
        <Button type="submit" size="xs" variant="outline" disabled={disabled}>
          Apply trim
        </Button>
      </FieldGroup>
    </form>
  );
}
