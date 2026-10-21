import { useState } from "react";
import type { Clip } from "@sidecut/contracts/project";
import { Button } from "@sidecut/ui/components/button";
import { Input } from "@sidecut/ui/components/input";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
  FieldError,
} from "@sidecut/ui/components/field";
import { useEditorSession } from "./editor-session";

export function ClipEditForm({ clip }: { clip: Clip }) {
  const { session, snapshot } = useEditorSession();
  const [amount, setAmount] = useState("0.1"),
    [error, setError] = useState<string | null>(null);
  const track = [...snapshot.project.videoTracks, ...snapshot.project.audioTracks].find((t) =>
    t.clips.some((c) => c.id === clip.id),
  );
  const next = track?.clips.find(
    (c) => c.id !== clip.id && c.start.flicks === clip.start.flicks + clip.duration.flicks,
  );
  const disabled = snapshot.readOnly || snapshot.busy || track?.locked;
  const apply = (kind: "slip" | "slide" | "roll" | "start" | "end") => {
    setError(null);
    try {
      const delta = Number(amount);
      if (!amount.trim() || !Number.isFinite(delta)) throw new Error("Enter a finite edit amount.");
      const command =
        kind === "slip"
          ? { slip: { clipID: clip.id, delta } }
          : kind === "slide"
            ? { slide: { clipID: clip.id, delta } }
            : kind === "roll"
              ? { roll: { leftClipID: clip.id, rightClipID: next?.id ?? "", delta } }
              : {
                  trim: {
                    clipID: clip.id,
                    edge: kind,
                    to: clip.start.seconds + (kind === "end" ? clip.duration.seconds : 0) + delta,
                    ripple: true,
                  },
                };
      session.apply({
        label:
          kind === "start" || kind === "end"
            ? `Ripple trim ${kind}`
            : `${kind[0]?.toUpperCase()}${kind.slice(1)} clip`,
        expectedRevision: snapshot.revision,
        commands: [command],
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  return (
    <form
      className="editor-trim-form"
      onSubmit={(e) => {
        e.preventDefault();
        apply("slip");
      }}
    >
      <FieldGroup>
        <Field data-invalid={Boolean(error)}>
          <FieldLabel htmlFor="edit-amount">Edit amount (s)</FieldLabel>
          <Input
            id="edit-amount"
            type="number"
            step="any"
            required
            disabled={disabled}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            aria-invalid={Boolean(error)}
            aria-describedby="edit-amount-help"
          />
          <FieldDescription id="edit-amount-help">
            Signed amount in seconds. Slip changes source time; slide moves the clip and trims
            touching neighbors. Roll moves its next cut.
          </FieldDescription>
          {error && <FieldError>{error}</FieldError>}
        </Field>
        <div className="editor-clip-edit-actions">
          <Button type="submit" size="xs" variant="outline" disabled={disabled}>
            Slip source
          </Button>
          <Button
            type="button"
            size="xs"
            variant="outline"
            disabled={disabled}
            onClick={() => apply("slide")}
          >
            Slide clip
          </Button>
          <Button
            type="button"
            size="xs"
            variant="outline"
            disabled={disabled || !next}
            onClick={() => apply("roll")}
          >
            Roll next cut
          </Button>
          <Button
            type="button"
            size="xs"
            variant="outline"
            disabled={disabled}
            onClick={() => apply("start")}
          >
            Ripple start
          </Button>
          <Button
            type="button"
            size="xs"
            variant="outline"
            disabled={disabled}
            onClick={() => apply("end")}
          >
            Ripple end
          </Button>
        </div>
        <p>
          Ripple start keeps the clip's timeline start and shifts later clips. Linked partners edit
          together.
        </p>
      </FieldGroup>
    </form>
  );
}
