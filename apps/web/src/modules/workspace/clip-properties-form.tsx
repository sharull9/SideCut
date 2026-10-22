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

export function ClipPropertiesForm({ clip }: { clip: Clip }) {
  const { session, snapshot } = useEditorSession();
  const [name, setName] = useState(clip.name ?? ""),
    [tags, setTags] = useState(clip.tags.join(", ")),
    [speed, setSpeed] = useState(String(clip.speed)),
    [ripple, setRipple] = useState(false),
    [enabled, setEnabled] = useState(clip.enabled),
    [holdEdges, setHoldEdges] = useState(clip.holdEdges ?? false),
    [start, setStart] = useState(String(clip.start.seconds)),
    [duration, setDuration] = useState(String(clip.duration.seconds)),
    [error, setError] = useState<string | null>(null);
  const track = [...snapshot.project.videoTracks, ...snapshot.project.audioTracks].find((t) =>
    t.clips.some((c) => c.id === clip.id),
  );
  const disabled = snapshot.readOnly || snapshot.busy || track?.locked;
  const run = (label: string, command: unknown) => {
    setError(null);
    try {
      session.apply({ label, expectedRevision: snapshot.revision, commands: [command] });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  return (
    <div className="editor-trim-form">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          run("Update clip", {
            updateClip: {
              clipID: clip.id,
              patch: {
                name: name.trim() || null,
                tags: tags
                  .split(",")
                  .map((tag) => tag.trim())
                  .filter(Boolean),
                enabled,
                holdEdges,
              },
            },
          });
        }}
      >
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="clip-name">Clip name</FieldLabel>
            <Input
              id="clip-name"
              disabled={disabled}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="clip-tags">Tags</FieldLabel>
            <Input
              id="clip-tags"
              disabled={disabled}
              value={tags}
              onChange={(e) => setTags(e.target.value)}
            />
            <FieldDescription>Separate tags with commas.</FieldDescription>
          </Field>
          <Field orientation="horizontal">
            <FieldLabel htmlFor="clip-enabled">Enabled</FieldLabel>
            <input
              id="clip-enabled"
              type="checkbox"
              disabled={disabled}
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
          </Field>
          <Field orientation="horizontal">
            <FieldLabel htmlFor="clip-hold-edges">Hold source edges</FieldLabel>
            <input
              id="clip-hold-edges"
              type="checkbox"
              disabled={disabled}
              checked={holdEdges}
              onChange={(e) => setHoldEdges(e.target.checked)}
            />
            <FieldDescription>
              Hold the first or last picture past the file bounds. Sound outside the file stays
              silent.
            </FieldDescription>
          </Field>
          <Button type="submit" size="xs" variant="outline" disabled={disabled}>
            Save clip properties
          </Button>
        </FieldGroup>
      </form>
      <form
        className="editor-trim-form"
        onSubmit={(event) => {
          event.preventDefault();
          run("Change clip speed", { setSpeed: { clipID: clip.id, speed: Number(speed), ripple } });
        }}
      >
        <FieldGroup>
          <Field data-invalid={Boolean(error)}>
            <FieldLabel htmlFor="clip-speed">Playback speed</FieldLabel>
            <Input
              id="clip-speed"
              type="number"
              min="0.000001"
              max="100"
              step="any"
              required
              disabled={disabled || clip.freezeFrame}
              value={speed}
              onChange={(e) => setSpeed(e.target.value)}
              aria-invalid={Boolean(error)}
            />
            <FieldDescription>
              Above 0, up to 100. Linked clips change together. Sound at another speed needs the
              planned pitch-correction renderer.
            </FieldDescription>
          </Field>
          <Field orientation="horizontal">
            <FieldLabel htmlFor="speed-ripple">Ripple later clips</FieldLabel>
            <input
              id="speed-ripple"
              type="checkbox"
              disabled={disabled}
              checked={ripple}
              onChange={(e) => setRipple(e.target.checked)}
            />
          </Field>
          <Button type="submit" size="xs" variant="outline" disabled={disabled || clip.freezeFrame}>
            Apply speed
          </Button>
        </FieldGroup>
      </form>
      {track?.kind === "video" && (
        <form
          className="editor-trim-form"
          onSubmit={(event) => {
            event.preventDefault();
            run("Hold frame over range", {
              holdFrame: {
                clipID: clip.id,
                range: { start: Number(start), duration: Number(duration) },
              },
            });
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="hold-start">Hold start (timeline s)</FieldLabel>
              <Input
                id="hold-start"
                type="number"
                step="any"
                min={clip.start.seconds}
                required
                disabled={disabled}
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="hold-duration">Hold duration (s)</FieldLabel>
              <Input
                id="hold-duration"
                type="number"
                step="any"
                min="0.000001"
                required
                disabled={disabled}
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
              />
              <FieldDescription>
                Freeze the picture from one frame before this range. Linked sound continues playing.
              </FieldDescription>
            </Field>
            <Button type="submit" size="xs" variant="outline" disabled={disabled}>
              Hold frame
            </Button>
          </FieldGroup>
        </form>
      )}
      <div className="editor-clip-edit-actions editor-trim-form">
        <Button
          size="xs"
          variant="outline"
          disabled={disabled}
          onClick={() => run("Join next clip", { join: { clipID: clip.id } })}
        >
          Join next clip
        </Button>
      </div>
      {error && <FieldError role="alert">{error}</FieldError>}
    </div>
  );
}
