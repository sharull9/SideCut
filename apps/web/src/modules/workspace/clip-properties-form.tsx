import { useState } from "react";
import type { Clip } from "@sidecut/contracts/project";
import { Button } from "@sidecut/ui/components/button";
import { Input } from "@sidecut/ui/components/input";
import { FieldError } from "@sidecut/ui/components/field";
import { useEditorSession } from "./editor-session";
import { ActionRow, Hint, InspectorSection, PropertyRow } from "./inspector-layout";

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
  const [angleTrack, setAngleTrack] = useState(track?.id ?? "");
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
    <>
      <InspectorSection id="timing.clip" title="Clip">
        <form
          className="editor-section-form"
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
          <PropertyRow label="Clip name" htmlFor="clip-name">
            <Input
              id="clip-name"
              disabled={disabled}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </PropertyRow>
          <PropertyRow label="Tags" htmlFor="clip-tags">
            <Input
              id="clip-tags"
              disabled={disabled}
              value={tags}
              onChange={(e) => setTags(e.target.value)}
            />
          </PropertyRow>
          <Hint>Separate tags with commas.</Hint>
          <PropertyRow label="Enabled" htmlFor="clip-enabled">
            <input
              id="clip-enabled"
              type="checkbox"
              disabled={disabled}
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
          </PropertyRow>
          <PropertyRow label="Hold source edges" htmlFor="clip-hold-edges">
            <input
              id="clip-hold-edges"
              type="checkbox"
              disabled={disabled}
              checked={holdEdges}
              onChange={(e) => setHoldEdges(e.target.checked)}
            />
          </PropertyRow>
          <Hint>
            Hold the first or last picture past the file bounds. Sound outside the file stays
            silent.
          </Hint>
          <ActionRow>
            <Button type="submit" size="xs" variant="outline" disabled={disabled}>
              Save clip properties
            </Button>
            <Button
              type="button"
              size="xs"
              variant="outline"
              disabled={disabled}
              onClick={() => run("Join next clip", { join: { clipID: clip.id } })}
            >
              Join next clip
            </Button>
          </ActionRow>
        </form>
      </InspectorSection>
      <InspectorSection id="timing.speed" title="Speed">
        <form
          className="editor-section-form"
          onSubmit={(event) => {
            event.preventDefault();
            run("Change clip speed", {
              setSpeed: { clipID: clip.id, speed: Number(speed), ripple },
            });
          }}
        >
          <PropertyRow label="Playback speed" htmlFor="clip-speed">
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
          </PropertyRow>
          <Hint>
            Above 0, up to 100. Linked clips change together. Sound at another speed needs the
            planned pitch-correction renderer.
          </Hint>
          <PropertyRow label="Ripple later clips" htmlFor="speed-ripple">
            <input
              id="speed-ripple"
              type="checkbox"
              disabled={disabled}
              checked={ripple}
              onChange={(e) => setRipple(e.target.checked)}
            />
          </PropertyRow>
          <ActionRow>
            <Button
              type="submit"
              size="xs"
              variant="outline"
              disabled={disabled || clip.freezeFrame}
            >
              Apply speed
            </Button>
          </ActionRow>
        </form>
      </InspectorSection>
      {track?.kind === "video" && (
        <InspectorSection id="timing.hold" title="Hold frame">
          <form
            className="editor-section-form"
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
            <PropertyRow label="Hold start (timeline s)" htmlFor="hold-start">
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
            </PropertyRow>
            <PropertyRow label="Hold duration (s)" htmlFor="hold-duration">
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
            </PropertyRow>
            <Hint>
              Freeze the picture from one frame before this range. Linked sound continues playing.
            </Hint>
            <ActionRow>
              <Button type="submit" size="xs" variant="outline" disabled={disabled}>
                Hold frame
              </Button>
            </ActionRow>
          </form>
        </InspectorSection>
      )}
      {track?.kind === "video" && (
        <InspectorSection id="timing.angle" title="Synced angle">
          <form
            className="editor-section-form"
            onSubmit={(event) => {
              event.preventDefault();
              run("Show synced angle", {
                showAngle: {
                  trackID: angleTrack,
                  range: { start: Number(start), duration: Number(duration) },
                },
              });
            }}
          >
            <PropertyRow label="Angle track" htmlFor="angle-track">
              <select
                id="angle-track"
                value={angleTrack}
                onChange={(e) => setAngleTrack(e.target.value)}
                disabled={disabled}
              >
                {snapshot.project.videoTracks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </PropertyRow>
            <PropertyRow label="Angle start (timeline s)" htmlFor="angle-start">
              <Input
                id="angle-start"
                type="number"
                min="0"
                step="any"
                required
                disabled={disabled}
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </PropertyRow>
            <PropertyRow label="Angle duration (s)" htmlFor="angle-duration">
              <Input
                id="angle-duration"
                type="number"
                min="0.000001"
                step="any"
                required
                disabled={disabled}
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
              />
            </PropertyRow>
            <Hint>
              Show the selected synced angle over the range. Choose the camera track to return to
              the base picture. Sound stays synchronized.
            </Hint>
            <ActionRow>
              <Button type="submit" size="xs" variant="outline" disabled={disabled}>
                Show selected angle
              </Button>
            </ActionRow>
          </form>
        </InspectorSection>
      )}
      {error && <FieldError role="alert">{error}</FieldError>}
    </>
  );
}
