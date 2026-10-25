import { useState } from "react";
import { RiScissorsLine } from "@remixicon/react";
import type { Clip } from "@sidecut/contracts/project";
import { Button } from "@sidecut/ui/components/button";
import { Input } from "@sidecut/ui/components/input";
import { FieldError } from "@sidecut/ui/components/field";
import { useEditorSession } from "./editor-session";
import { ActionRow, InspectorSection, PropertyRow } from "./inspector-layout";
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
    <InspectorSection id="timing.trim" title="Trim">
      <form
        className="editor-section-form"
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
        <PropertyRow label="Timeline start (s)" htmlFor="trim-start">
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
        </PropertyRow>
        <PropertyRow label="Timeline end (s)" htmlFor="trim-end">
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
        </PropertyRow>
        {error && <FieldError>{error}</FieldError>}
        <ActionRow>
          <Button type="submit" size="xs" variant="outline" disabled={disabled}>
            <RiScissorsLine aria-hidden="true" />
            Apply trim
          </Button>
        </ActionRow>
      </form>
    </InspectorSection>
  );
}
