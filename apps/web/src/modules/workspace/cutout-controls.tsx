import { useState, useSyncExternalStore } from "react";
import type { Clip } from "@sidecut/contracts/project";
import { cutoutSettings, type Cutout, type RepairMask } from "@sidecut/core/cutout";
import { Button } from "@sidecut/ui/components/button";
import { Field, FieldLabel, FieldDescription, FieldError } from "@sidecut/ui/components/field";
import { CommitInput } from "./commit-input";
import { useEditorSession } from "./editor-session";
import { pictureTime } from "@sidecut/core/render-plan";

export function CutoutControls({ clip }: { clip: Clip }) {
  const { session, snapshot, editor } = useEditorSession();
  const analysis = useSyncExternalStore(
    session.analysis.subscribe,
    session.analysis.getSnapshot,
    session.analysis.getSnapshot,
  );
  const [error, setError] = useState<string | null>(null);
  const mediaID = (clip.content.media as { mediaID?: string } | undefined)?.mediaID;
  if (!mediaID) return null;
  let settings: Cutout;
  try {
    settings = cutoutSettings(clip.video?.cutout ?? { enabled: false });
  } catch (e) {
    return <FieldError>{String(e)}</FieldError>;
  }
  const track = snapshot.project.videoTracks.find((t) => t.clips.some((c) => c.id === clip.id));
  const disabled = snapshot.readOnly || snapshot.busy || Boolean(track?.locked);
  const run = (action: () => unknown) => {
    setError(null);
    Promise.resolve()
      .then(action)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  };
  const update = (patch: Partial<Cutout>) =>
    run(() =>
      session.apply({
        label: "Update cutout",
        expectedRevision: snapshot.revision,
        commands: [
          {
            updateClip: {
              clipID: clip.id,
              patch: { video: { cutout: cutoutSettings({ ...settings, ...patch }) } },
            },
          },
        ],
      }),
    );
  const download = () =>
    run(async () => {
      const resource = await session.resource(mediaID),
        item = snapshot.project.media.find((m) => m.id === mediaID);
      if (!item || resource?.state !== "available" || item.kind === "audio")
        throw new Error("Import this picture source before downloading a cutout frame.");
      const { renderCutoutPNG } = await import("@sidecut/platform-browser/cutout");
      const time = pictureTime(snapshot.project, clip, editor.getState().playhead.seconds);
      const blob = await renderCutoutPNG(resource.file, item.kind, time, settings),
        url = URL.createObjectURL(blob),
        anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "cutout.png";
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    });
  const mask = (index: number, patch: Partial<RepairMask>) =>
    update({
      repairMasks: settings.repairMasks.map((v, i) => (i === index ? { ...v, ...patch } : v)),
    });
  return (
    <div className="editor-trim-form">
      <h3>Cutout</h3>
      <Field>
        <FieldLabel htmlFor="cutout-enabled">Background removal</FieldLabel>
        <select
          id="cutout-enabled"
          value={String(settings.enabled)}
          disabled={disabled}
          onChange={(e) => update({ enabled: e.target.value === "true" })}
        >
          <option value="false">Off</option>
          <option value="true">On</option>
        </select>
      </Field>
      <Button
        size="sm"
        variant="outline"
        disabled={disabled}
        onClick={() => run(() => session.analysis.cutout(mediaID))}
      >
        Analyse cutout
      </Button>
      <FieldDescription>
        Downloads a local segmentation model on first use. Media stays on this device. Sources up to
        60 seconds; use repair masks for missed accessories.
      </FieldDescription>
      <p role="status">
        {analysis[mediaID]?.matte
          ? `${analysis[mediaID]!.matte!.frames.length} matte frames ready`
          : (analysis[mediaID]?.status ??
            "Matte not analysed in this session. Saved mattes load when rendered.")}
      </p>
      <Field>
        <FieldLabel htmlFor="cutout-mode">Keep</FieldLabel>
        <select
          id="cutout-mode"
          value={settings.mode}
          disabled={disabled}
          onChange={(e) => update({ mode: e.target.value as Cutout["mode"] })}
        >
          <option value="person">Person</option>
          <option value="personAndProps">Person and accessories</option>
        </select>
      </Field>
      <div className="editor-picture-fields">
        {(
          [
            ["edgeFeather", "Edge feather", 0],
            ["choke", "Choke", -100],
          ] as const
        ).map(([key, label, min]) => (
          <Field key={key}>
            <FieldLabel htmlFor={`cutout-${key}`}>{label} at 1080p</FieldLabel>
            <CommitInput
              id={`cutout-${key}`}
              value={settings[key]}
              min={min}
              max={100}
              unit="px"
              disabled={disabled}
              onCommit={(v) => update({ [key]: Number(v) })}
            />
          </Field>
        ))}
      </div>
      <h4>Repair masks</h4>
      <Button
        size="sm"
        variant="outline"
        disabled={disabled || !settings.enabled}
        onClick={download}
      >
        Download cutout PNG
      </Button>
      <FieldDescription>
        Downloads the current source frame with transparency, up to 1280 px wide.
      </FieldDescription>
      <FieldDescription>
        Rectangles use percentages of the original source before crop and transform. Masks apply for
        the whole clip.
      </FieldDescription>
      {settings.repairMasks.map((m, i) => (
        <fieldset className="editor-trim-form" key={i}>
          <legend>Mask {i + 1}</legend>
          <Field>
            <FieldLabel htmlFor={`mask-${i}-mode`}>Action</FieldLabel>
            <select
              id={`mask-${i}-mode`}
              value={m.mode}
              disabled={disabled}
              onChange={(e) => mask(i, { mode: e.target.value as RepairMask["mode"] })}
            >
              <option value="include">Include</option>
              <option value="exclude">Exclude</option>
            </select>
          </Field>
          <Field>
            <FieldLabel htmlFor={`mask-${i}-shape`}>Shape</FieldLabel>
            <select
              id={`mask-${i}-shape`}
              value={m.shape}
              disabled={disabled}
              onChange={(e) => mask(i, { shape: e.target.value as RepairMask["shape"] })}
            >
              <option value="rectangle">Rectangle</option>
              <option value="roundedRectangle">Rounded rectangle</option>
              <option value="ellipse">Ellipse</option>
            </select>
          </Field>
          <div className="editor-picture-fields">
            {(["x", "y", "width", "height"] as const).map((key) => (
              <Field key={key}>
                <FieldLabel htmlFor={`mask-${i}-${key}`}>{key}</FieldLabel>
                <CommitInput
                  id={`mask-${i}-${key}`}
                  value={m.rect[key]}
                  factor={100}
                  unit="%"
                  min={0}
                  max={100}
                  disabled={disabled}
                  onCommit={(v) => mask(i, { rect: { ...m.rect, [key]: Number(v) } })}
                />
              </Field>
            ))}
            {(["cornerRadius", "feather"] as const).map((key) => (
              <Field key={key}>
                <FieldLabel htmlFor={`mask-${i}-${key}`}>
                  {key === "feather" ? "Feather" : "Corner radius"}
                </FieldLabel>
                <CommitInput
                  id={`mask-${i}-${key}`}
                  value={m[key]}
                  min={0}
                  max={100}
                  unit="px"
                  disabled={disabled}
                  onCommit={(v) => mask(i, { [key]: Number(v) })}
                />
              </Field>
            ))}
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={disabled}
            onClick={() => update({ repairMasks: settings.repairMasks.filter((_, n) => n !== i) })}
          >
            Remove mask {i + 1}
          </Button>
        </fieldset>
      ))}
      <Button
        size="sm"
        variant="outline"
        disabled={disabled || settings.repairMasks.length >= 64}
        onClick={() =>
          update({
            repairMasks: [
              ...settings.repairMasks,
              {
                shape: "rectangle",
                mode: "include",
                rect: { x: 0.4, y: 0.4, width: 0.2, height: 0.2 },
                cornerRadius: 0,
                feather: 0,
              },
            ],
          })
        }
      >
        Add repair mask
      </Button>
      {(error || analysis[mediaID]?.error) && (
        <FieldError>{error || analysis[mediaID]?.error}</FieldError>
      )}
    </div>
  );
}
