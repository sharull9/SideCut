import { useState } from "react";
import type { Project, Track } from "@sidecut/contracts/project";
import { transitionWindow } from "@sidecut/core/transitions";
import { Button } from "@sidecut/ui/components/button";
import {
  Field,
  FieldLabel,
  FieldDescription,
  FieldError,
  FieldGroup,
} from "@sidecut/ui/components/field";
import { Input } from "@sidecut/ui/components/input";
import { useEditorSession } from "./editor-session";
interface SoundDefault {
  mediaID: string;
  gainDB: number;
  offset: number;
}
const defaultKey = (projectID: string, type: string) =>
  `sidecut:transitionSound:${projectID}:${type}`;
export function defaultTransitionSound(
  project: Project,
  type: string,
): SoundDefault | null | undefined {
  try {
    const raw = localStorage.getItem(defaultKey(project.id, type));
    if (raw == null) return undefined;
    const value: unknown = JSON.parse(raw);
    if (value === null) return null;
    if (
      value &&
      typeof value === "object" &&
      "mediaID" in value &&
      "gainDB" in value &&
      "offset" in value &&
      typeof value.mediaID === "string" &&
      typeof value.gainDB === "number" &&
      Number.isFinite(value.gainDB) &&
      typeof value.offset === "number" &&
      Number.isFinite(value.offset) &&
      project.media.some((m) => m.id === value.mediaID && m.hasAudio)
    )
      return value as SoundDefault;
  } catch {
    /* A missing or corrupt preference uses the type's built-in default. */
  }
  return undefined;
}
export function TransitionSoundControls({
  track,
  transition,
}: {
  track: Track;
  transition: Track["transitions"][number];
}) {
  const { snapshot, session } = useEditorSession(),
    project = snapshot.project;
  const current = project.audioTracks
    .flatMap((t) => t.clips)
    .find((c) => c.id === transition.soundClipID);
  const ref = current?.content.media,
    currentID = ref && typeof ref === "object" && "mediaID" in ref ? String(ref.mediaID) : "";
  const window = transitionWindow(track, transition),
    center = window ? window.start + window.duration / 2 : 0;
  const [mediaID, setMediaID] = useState(currentID),
    [gainDB, setGain] = useState(String(current?.audio?.gainDB ?? -15)),
    [offset, setOffset] = useState(
      String(current ? current.start.seconds - center : (window?.start ?? 0) - center),
    ),
    [tie, setTie] = useState(""),
    [error, setError] = useState<string | null>(null),
    [notice, setNotice] = useState("");
  const disabled = snapshot.readOnly || snapshot.busy || track.locked;
  const sound = () => {
    if (!mediaID) return null;
    if (!Number.isFinite(Number(gainDB)) || !Number.isFinite(Number(offset)))
      throw new Error("Sound gain and offset must be finite numbers.");
    return { mediaID, gainDB: Number(gainDB), offset: Number(offset) };
  };
  const run = (patch: object) => {
    setError(null);
    try {
      session.apply({
        label: "Edit transition sound",
        expectedRevision: snapshot.revision,
        commands: [{ updateTransition: { transitionID: transition.id, patch } }],
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const media = project.media.find((m) => m.id === mediaID);
  const type = String(transition.type),
    builtIn = ["push", "slide", "cutSlide", "wipe"].includes(type);
  return (
    <section className="editor-trim-form" aria-label="Transition sound">
      <h3>Sound</h3>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor={`sound-media-${transition.id}`}>Source</FieldLabel>
          <select
            id={`sound-media-${transition.id}`}
            value={mediaID}
            disabled={disabled}
            onChange={(e) => setMediaID(e.target.value)}
          >
            <option value="">None</option>
            {project.media
              .filter((m) => m.hasAudio)
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.path}
                </option>
              ))}
          </select>
        </Field>
        {media && (
          <FieldDescription>
            Source: {media.path}
            {typeof media.attribution === "string" ? ` · ${media.attribution}` : ""}. Source
            metadata is retained with this media item.
          </FieldDescription>
        )}
        <Field>
          <FieldLabel htmlFor={`sound-gain-${transition.id}`}>Sound gain (dB)</FieldLabel>
          <Input
            id={`sound-gain-${transition.id}`}
            type="number"
            value={gainDB}
            disabled={disabled}
            onChange={(e) => setGain(e.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`sound-offset-${transition.id}`}>
            Start from cut midpoint (s)
          </FieldLabel>
          <Input
            id={`sound-offset-${transition.id}`}
            type="number"
            value={offset}
            step="any"
            disabled={disabled}
            onChange={(e) => setOffset(e.target.value)}
          />
        </Field>
        <Button
          size="xs"
          variant="outline"
          disabled={disabled}
          onClick={() => {
            try {
              run({ sound: sound() });
            } catch (cause) {
              setError(String(cause));
            }
          }}
        >
          Apply sound
        </Button>
        <Button
          size="xs"
          variant="ghost"
          disabled={disabled || !current}
          onClick={() => run({ soundClipID: null })}
        >
          Detach sound and keep clip
        </Button>
        <Field>
          <FieldLabel htmlFor={`sound-tie-${transition.id}`}>Existing audio clip</FieldLabel>
          <select
            id={`sound-tie-${transition.id}`}
            disabled={disabled}
            value={tie}
            onChange={(e) => setTie(e.target.value)}
          >
            <option value="">Choose clip</option>
            {project.audioTracks
              .flatMap((t) => t.clips)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name ?? c.id}
                </option>
              ))}
          </select>
        </Field>
        <Button
          size="xs"
          variant="outline"
          disabled={disabled || !tie}
          onClick={() => run({ soundClipID: tie })}
        >
          Tie existing clip
        </Button>
        <Button
          size="xs"
          variant="outline"
          disabled={disabled}
          onClick={() => {
            try {
              localStorage.setItem(defaultKey(project.id, type), JSON.stringify(sound()));
              setNotice(`Default saved for ${type} in this project.`);
              setError(null);
            } catch (cause) {
              setError(String(cause));
            }
          }}
        >
          Remember as {type} default
        </Button>
        <Button
          size="xs"
          variant="ghost"
          disabled={disabled}
          onClick={() => {
            const value = defaultTransitionSound(project, type);
            if (value === undefined && builtIn) {
              setError(
                "The built-in light swoosh is unavailable. Import a local sound and remember it as this type's default.",
              );
              return;
            }
            run({ sound: value ?? null });
          }}
        >
          Use type default
        </Button>
        <FieldDescription>
          {builtIn
            ? "Built-in light swoosh: elevenlabs:sfx_2ybnc2tu, −23.3 dB, offset −0.39 s. Its licensed asset is not bundled. Choose a local source to replace it."
            : "This type is silent by default."}{" "}
          Remembered choices apply to new transitions and type changes. Sound clips remain editable
          on SFX tracks.
        </FieldDescription>
        {notice && <p role="status">{notice}</p>}
        {error && <FieldError role="alert">{error}</FieldError>}
      </FieldGroup>
    </section>
  );
}
