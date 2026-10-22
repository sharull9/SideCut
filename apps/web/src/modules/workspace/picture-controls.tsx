import { useState } from "react";
import type { Clip } from "@sidecut/contracts/project";
import { transformOf } from "@sidecut/core/picture-editing";
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
import { RegionZoomDialog } from "./region-zoom-dialog";

export function PictureControls({ clip }: { clip: Clip }) {
  const { snapshot, session } = useEditorSession();
  const track = snapshot.project.videoTracks.find((t) => t.clips.some((c) => c.id === clip.id));
  const disabled = snapshot.readOnly || snapshot.busy || Boolean(track?.locked);
  const transform = transformOf(clip);
  const crop = clip.video?.crop as Record<string, number> | undefined;
  const [values, setValues] = useState(() => ({
    x: transform.position.x,
    y: transform.position.y,
    scale: transform.scale,
    rotation: transform.rotation,
    opacity: Number(clip.video?.opacity ?? 1),
    left: crop?.left ?? 0,
    top: crop?.top ?? 0,
    right: crop?.right ?? 0,
    bottom: crop?.bottom ?? 0,
  }));
  const [preset, setPreset] = useState(
      typeof clip.video?.layoutPreset === "string" &&
        ["full", "pipRight", "pipLeft", "split", "fill"].includes(clip.video.layoutPreset)
        ? clip.video.layoutPreset
        : "full",
    ),
    [motion, setMotion] = useState("zoomIn"),
    [amount, setAmount] = useState("1.12"),
    [error, setError] = useState<string | null>(null);
  const run = (label: string, command: unknown) => {
    setError(null);
    try {
      session.apply({ label, expectedRevision: snapshot.revision, commands: [command] });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  if (!track) return null;
  return (
    <div className="editor-trim-form">
      <h3>Picture</h3>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          run("Update picture", {
            updateClip: {
              clipID: clip.id,
              patch: {
                video: {
                  transform: {
                    position: { x: values.x, y: values.y },
                    scale: values.scale,
                    rotation: values.rotation,
                  },
                  opacity: values.opacity,
                  crop: {
                    left: values.left,
                    top: values.top,
                    right: values.right,
                    bottom: values.bottom,
                  },
                },
              },
            },
          });
        }}
      >
        <FieldGroup className="editor-picture-fields">
          {(
            [
              ["x", "Center X"],
              ["y", "Center Y"],
              ["scale", "Scale"],
              ["rotation", "Clockwise degrees"],
              ["opacity", "Opacity"],
              ["left", "Crop left"],
              ["top", "Crop top"],
              ["right", "Crop right"],
              ["bottom", "Crop bottom"],
            ] as const
          ).map(([key, label]) => (
            <Field key={key}>
              <FieldLabel htmlFor={`picture-${key}`}>{label}</FieldLabel>
              <Input
                id={`picture-${key}`}
                type="number"
                step="any"
                required
                disabled={disabled}
                value={values[key]}
                min={["opacity", "left", "top", "right", "bottom"].includes(key) ? 0 : undefined}
                max={["opacity", "left", "top", "right", "bottom"].includes(key) ? 1 : undefined}
                onChange={(e) =>
                  setValues((v) => ({
                    ...v,
                    [key]: e.target.value === "" ? "" : Number(e.target.value),
                  }))
                }
              />
            </Field>
          ))}
          <FieldDescription>
            Position uses canvas fractions; crop uses source fractions. Crop keeps the source center
            in place. Keyframes override these base values.
          </FieldDescription>
          <Button type="submit" size="xs" variant="outline" disabled={disabled}>
            Apply picture
          </Button>
        </FieldGroup>
      </form>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          run("Apply layout", { applyLayout: { clipIDs: [clip.id], preset } });
        }}
      >
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="picture-layout">Layout preset</FieldLabel>
            <select
              id="picture-layout"
              value={preset}
              onChange={(e) => setPreset(e.target.value)}
              disabled={disabled}
            >
              {[
                ["full", "Full"],
                ["pipRight", "PiP right"],
                ["pipLeft", "PiP left"],
                ["split", "Split"],
                ["fill", "Fill"],
              ].map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
            <FieldDescription>
              PiP enables portrait cutout and shadow settings. Their rendering is planned. Full
              resets placement, crop, cutout and shadow.
            </FieldDescription>
          </Field>
          <Button type="submit" size="xs" variant="outline" disabled={disabled}>
            Apply layout
          </Button>
          <Button
            size="xs"
            variant="ghost"
            disabled={disabled}
            onClick={() =>
              run("Reset picture layout", { applyLayout: { clipIDs: [clip.id], preset: "full" } })
            }
          >
            Reset layout to full
          </Button>
        </FieldGroup>
      </form>
      <RegionZoomDialog clip={clip} disabled={disabled} />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          run("Add picture motion", {
            addMotion: { clipIDs: [clip.id], style: motion, amount: Number(amount) },
          });
        }}
      >
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="picture-motion">Motion preset</FieldLabel>
            <select
              id="picture-motion"
              disabled={disabled}
              value={motion}
              onChange={(e) => setMotion(e.target.value)}
            >
              {["zoomIn", "zoomOut", "panLeft", "panRight", "panUp", "panDown"].map((m) => (
                <option key={m} value={m}>
                  {m[0]!.toUpperCase() +
                    m
                      .slice(1)
                      .replace(/([A-Z])/g, " $1")
                      .toLowerCase()}
                </option>
              ))}
            </select>
          </Field>
          <Field>
            <FieldLabel htmlFor="motion-amount">Motion amount</FieldLabel>
            <Input
              id="motion-amount"
              type="number"
              min="1"
              max="3"
              step="any"
              required
              disabled={disabled}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="motion-duration">Motion duration (s)</FieldLabel>
            <Input id="motion-duration" readOnly value={clip.duration.seconds} />
            <FieldDescription>
              Motion spans the whole clip. Trim the clip to change its duration. Existing scale and
              position keys are replaced.
            </FieldDescription>
          </Field>
          <Button type="submit" size="xs" variant="outline" disabled={disabled}>
            Apply motion
          </Button>
        </FieldGroup>
      </form>
      {error && <FieldError role="alert">{error}</FieldError>}
    </div>
  );
}

export function PictureInspector({ clips }: { clips: readonly Clip[] }) {
  const { snapshot } = useEditorSession();
  const [id, setID] = useState(clips[0]?.id ?? "");
  const ids = new Set(snapshot.project.videoTracks.flatMap((t) => t.clips.map((c) => c.id)));
  const pictures = clips.filter((c) => ids.has(c.id));
  const clip = pictures.find((c) => c.id === id) ?? pictures[0];
  if (!clip) return null;
  return (
    <>
      {pictures.length > 1 && (
        <Field className="editor-trim-form">
          <FieldLabel htmlFor="picture-clip">Picture clip</FieldLabel>
          <select id="picture-clip" value={clip.id} onChange={(e) => setID(e.target.value)}>
            {pictures.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name ?? c.id}
              </option>
            ))}
          </select>
        </Field>
      )}
      <PictureControls key={`${clip.id}:${snapshot.revision}`} clip={clip} />
    </>
  );
}
