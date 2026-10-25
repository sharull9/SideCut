import { useState } from "react";
import { RiFilmLine, RiResetLeftLine } from "@remixicon/react";
import type { Clip } from "@sidecut/contracts/project";
import { transformOf } from "@sidecut/core/picture-editing";
import { Button } from "@sidecut/ui/components/button";
import { Input } from "@sidecut/ui/components/input";
import { FieldError } from "@sidecut/ui/components/field";
import { useEditorSession } from "./editor-session";
import { RegionZoomDialog } from "./region-zoom-dialog";
import { CommitInput } from "./commit-input";
import { CutoutControls } from "./cutout-controls";
import {
  ActionRow,
  HiddenLabel,
  Hint,
  InspectorSection,
  PropertyPair,
  PropertyRow,
} from "./inspector-layout";

type PictureKey =
  | "x"
  | "y"
  | "scale"
  | "rotation"
  | "opacity"
  | "left"
  | "top"
  | "right"
  | "bottom";
// Stored as fractions; shown as percentages except rotation.
const PICTURE_FIELDS: readonly [PictureKey, string, number, string, number?, number?][] = [
  ["x", "Position X", 100, "%"],
  ["y", "Position Y", 100, "%"],
  ["scale", "Scale", 100, "%", 0],
  ["rotation", "Rotation", 1, "°"],
  ["opacity", "Opacity", 100, "%", 0, 100],
  ["left", "Crop left", 100, "%", 0, 100],
  ["right", "Crop right", 100, "%", 0, 100],
  ["top", "Crop top", 100, "%", 0, 100],
  ["bottom", "Crop bottom", 100, "%", 0, 100],
];

export function PictureControls({ clip }: { clip: Clip }) {
  const { snapshot, session } = useEditorSession();
  const track = snapshot.project.videoTracks.find((t) => t.clips.some((c) => c.id === clip.id));
  const disabled = snapshot.readOnly || snapshot.busy || Boolean(track?.locked);
  const adjustment = clip.content.adjustment != null;
  const transform = transformOf(clip);
  const crop = clip.video?.crop as Record<string, number> | undefined;
  const values: Record<PictureKey, number> = {
    x: transform.position.x,
    y: transform.position.y,
    scale: transform.scale,
    rotation: transform.rotation,
    opacity: Number(clip.video?.opacity ?? 1),
    left: crop?.left ?? 0,
    top: crop?.top ?? 0,
    right: crop?.right ?? 0,
    bottom: crop?.bottom ?? 0,
  };
  const preset =
    typeof clip.video?.layoutPreset === "string" &&
    ["full", "pipRight", "pipLeft", "split", "fill"].includes(clip.video.layoutPreset)
      ? clip.video.layoutPreset
      : "full";
  const [motion, setMotion] = useState("zoomIn"),
    [amount, setAmount] = useState("1.12"),
    [error, setError] = useState<string | null>(null);
  const run = (label: string, command: unknown) => {
    setError(null);
    try {
      session.apply({
        label,
        expectedRevision: session.getSnapshot().revision,
        commands: [command],
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const update = (key: PictureKey, value: number) => {
    const v = { ...values, [key]: value };
    run("Update picture", {
      updateClip: {
        clipID: clip.id,
        patch: {
          video: adjustment
            ? { opacity: v.opacity }
            : {
                transform: { position: { x: v.x, y: v.y }, scale: v.scale, rotation: v.rotation },
                opacity: v.opacity,
                crop: { left: v.left, top: v.top, right: v.right, bottom: v.bottom },
              },
        },
      },
    });
  };
  if (!track) return null;
  // With a prefix the input shows only an axis letter; a hidden label keeps its full name.
  const input = (key: PictureKey, prefix?: string) => {
    const [, label, factor, unit, min, max] = PICTURE_FIELDS.find(([k]) => k === key)!;
    return (
      <>
        {prefix && <HiddenLabel htmlFor={`picture-${key}`}>{label}</HiddenLabel>}
        <CommitInput
          id={`picture-${key}`}
          value={values[key]}
          factor={factor}
          unit={unit}
          prefix={prefix}
          min={min}
          max={max}
          disabled={disabled}
          onCommit={(value) => update(key, Number(value))}
        />
      </>
    );
  };
  const single = (key: PictureKey) => {
    const [, label] = PICTURE_FIELDS.find(([k]) => k === key)!;
    return (
      <PropertyRow label={label} htmlFor={`picture-${key}`}>
        {input(key)}
      </PropertyRow>
    );
  };
  const pair = (title: string, a: [PictureKey, string], b: [PictureKey, string]) => (
    <PropertyRow label={title}>
      <PropertyPair>
        {input(a[0], a[1])}
        {input(b[0], b[1])}
      </PropertyPair>
    </PropertyRow>
  );
  return (
    <>
      <InspectorSection id="picture.transform" title={adjustment ? "Blend" : "Transform"}>
        {!adjustment && (
          <>
            {pair("Position", ["x", "X"], ["y", "Y"])}
            {single("scale")}
            {single("rotation")}
          </>
        )}
        {single("opacity")}
        <Hint>
          {adjustment
            ? "Blends the adjusted picture with the layers below."
            : "Changes apply when you press Enter or leave a field. Keyframes override these values."}
        </Hint>
      </InspectorSection>
      {!adjustment && (
        <>
          <InspectorSection id="picture.crop" title="Crop">
            {pair("Left / right", ["left", "L"], ["right", "R"])}
            {pair("Top / bottom", ["top", "T"], ["bottom", "B"])}
          </InspectorSection>
          <InspectorSection id="picture.layout" title="Layout">
            <PropertyRow label="Layout" htmlFor="picture-layout">
              <select
                id="picture-layout"
                value={preset}
                onChange={(e) =>
                  run("Apply layout", {
                    applyLayout: { clipIDs: [clip.id], preset: e.target.value },
                  })
                }
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
            </PropertyRow>
            <Hint>Choosing a layout replaces position, scale, and crop.</Hint>
            <ActionRow>
              <Button
                size="xs"
                variant="outline"
                disabled={disabled}
                onClick={() =>
                  run("Reset picture", {
                    applyLayout: { clipIDs: [clip.id], preset: "full" },
                  })
                }
              >
                <RiResetLeftLine aria-hidden="true" />
                Reset picture
              </Button>
              <RegionZoomDialog clip={clip} disabled={disabled} />
            </ActionRow>
          </InspectorSection>
          <InspectorSection id="picture.motion" title="Motion">
            <form
              className="editor-section-form"
              onSubmit={(e) => {
                e.preventDefault();
                run("Add picture motion", {
                  addMotion: { clipIDs: [clip.id], style: motion, amount: Number(amount) },
                });
              }}
            >
              <PropertyRow label="Motion preset" htmlFor="picture-motion">
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
              </PropertyRow>
              <PropertyRow label="Motion amount" htmlFor="motion-amount">
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
              </PropertyRow>
              <Hint>
                Runs for the whole clip ({clip.duration.seconds.toFixed(2)} s) and replaces existing
                scale and position keyframes.
              </Hint>
              <ActionRow>
                <Button type="submit" size="xs" variant="outline" disabled={disabled}>
                  <RiFilmLine aria-hidden="true" />
                  Add motion
                </Button>
              </ActionRow>
            </form>
          </InspectorSection>
        </>
      )}
      {error && <FieldError role="alert">{error}</FieldError>}
    </>
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
        <div className="editor-section editor-section-plain">
          <div className="editor-section-body">
            <PropertyRow label="Picture clip" htmlFor="picture-clip">
              <select id="picture-clip" value={clip.id} onChange={(e) => setID(e.target.value)}>
                {pictures.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name ?? c.id}
                  </option>
                ))}
              </select>
            </PropertyRow>
          </div>
        </div>
      )}
      <PictureControls key={clip.id} clip={clip} />
      <CutoutControls key={`cutout-${clip.id}`} clip={clip} />
    </>
  );
}
