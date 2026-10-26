import { Fragment, useState, useSyncExternalStore } from "react";
import { RiAddLine, RiDeleteBinLine, RiDownloadLine, RiScanLine } from "@remixicon/react";
import type { Clip } from "@sidecut/contracts/project";
import { cutoutSettings, type Cutout, type RepairMask } from "@sidecut/core/cutout";
import { Button } from "@sidecut/ui/components/button";
import { FieldError } from "@sidecut/ui/components/field";
import {
  ActionRow,
  HiddenLabel,
  Hint,
  InspectorSection,
  PropertyPair,
  PropertyRow,
} from "./inspector-layout";
import { CommitInput } from "./commit-input";
import { useEditorSession } from "./editor-session";
import { pictureTime } from "@sidecut/core/render-plan";
import { readPreference, writePreference } from "@sidecut/platform-browser/preferences";
import type { MattingBackend } from "@sidecut/platform-browser/matting-models";

const MASK_PAIRS = [
  [
    "Position",
    [
      ["x", "X"],
      ["y", "Y"],
    ],
  ],
  [
    "Size",
    [
      ["width", "W"],
      ["height", "H"],
    ],
  ],
] as const;

export function CutoutControls({ clip }: { clip: Clip }) {
  const { session, snapshot, editor } = useEditorSession();
  const analysis = useSyncExternalStore(
    session.analysis.subscribe,
    session.analysis.getSnapshot,
    session.analysis.getSnapshot,
  );
  const [error, setError] = useState<string | null>(null);
  const [backend, setBackend] = useState<MattingBackend>(
    readPreference("sidecut.matte.backend") === "rvm" ? "rvm" : "mediapipe",
  );
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
    <>
      <InspectorSection id="picture.cutout" title="Cutout">
        <PropertyRow label="Background removal" htmlFor="cutout-enabled">
          <select
            id="cutout-enabled"
            value={String(settings.enabled)}
            disabled={disabled}
            onChange={(e) => update({ enabled: e.target.value === "true" })}
          >
            <option value="false">Off</option>
            <option value="true">On</option>
          </select>
        </PropertyRow>
        <PropertyRow label="Keep" htmlFor="cutout-mode">
          <select
            id="cutout-mode"
            value={settings.mode}
            disabled={disabled}
            onChange={(e) => update({ mode: e.target.value as Cutout["mode"] })}
          >
            <option value="person">Person</option>
            <option value="personAndProps">Person and accessories</option>
          </select>
        </PropertyRow>
        {(
          [
            ["edgeFeather", "Edge feather", 0],
            ["choke", "Choke", -100],
          ] as const
        ).map(([key, label, min]) => (
          <PropertyRow key={key} label={`${label} at 1080p`} htmlFor={`cutout-${key}`}>
            <CommitInput
              id={`cutout-${key}`}
              value={settings[key]}
              min={min}
              max={100}
              unit="px"
              disabled={disabled}
              onCommit={(v) => update({ [key]: Number(v) })}
            />
          </PropertyRow>
        ))}
        <PropertyRow label="Matting model" htmlFor="matting-backend">
          <select
            id="matting-backend"
            value={backend}
            disabled={disabled}
            onChange={(event) => {
              const value = event.target.value === "rvm" ? "rvm" : "mediapipe";
              setBackend(value);
              run(() => writePreference("sidecut.matte.backend", value));
            }}
          >
            <option value="mediapipe">MediaPipe · person and accessory masks</option>
            <option value="rvm">RVM · recurrent video matting</option>
          </select>
        </PropertyRow>
        <ActionRow>
          <Button
            size="xs"
            variant="outline"
            disabled={disabled}
            onClick={() => run(() => session.analysis.cutout(mediaID, backend))}
          >
            <RiScanLine aria-hidden="true" />
            Analyse cutout
          </Button>
          <Button
            size="xs"
            variant="outline"
            disabled={disabled || !settings.enabled}
            onClick={download}
          >
            <RiDownloadLine aria-hidden="true" />
            Download cutout PNG
          </Button>
        </ActionRow>
        <Hint role="status">
          {analysis[mediaID]?.matte
            ? `${analysis[mediaID]!.matte!.frames.length} matte frames ready`
            : (analysis[mediaID]?.status ??
              "Matte not analysed in this session. Saved mattes load when rendered.")}
        </Hint>
        <Hint>
          Downloads the selected model on first use. Media stays on this device. RVM carries
          temporal state between video frames and keeps foreground props. Use repair masks for
          missed accessories. Download saves the current source frame with transparency, up to 1280
          px wide.
        </Hint>
      </InspectorSection>
      <InspectorSection id="picture.repair" title="Repair masks">
        <Hint>
          Rectangles use percentages of the original source before crop and transform. Masks apply
          for the whole clip.
        </Hint>
        {settings.repairMasks.map((m, i) => (
          <fieldset className="editor-mask" key={i}>
            <legend>Mask {i + 1}</legend>
            <PropertyRow label="Action" htmlFor={`mask-${i}-mode`}>
              <select
                id={`mask-${i}-mode`}
                value={m.mode}
                disabled={disabled}
                onChange={(e) => mask(i, { mode: e.target.value as RepairMask["mode"] })}
              >
                <option value="include">Include</option>
                <option value="exclude">Exclude</option>
              </select>
            </PropertyRow>
            <PropertyRow label="Shape" htmlFor={`mask-${i}-shape`}>
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
            </PropertyRow>
            {MASK_PAIRS.map(([title, keys]) => (
              <PropertyRow key={title} label={title}>
                <PropertyPair>
                  {keys.map(([key, prefix]) => (
                    <Fragment key={key}>
                      <HiddenLabel htmlFor={`mask-${i}-${key}`}>{key}</HiddenLabel>
                      <CommitInput
                        id={`mask-${i}-${key}`}
                        value={m.rect[key]}
                        factor={100}
                        unit="%"
                        prefix={prefix}
                        min={0}
                        max={100}
                        disabled={disabled}
                        onCommit={(v) => mask(i, { rect: { ...m.rect, [key]: Number(v) } })}
                      />
                    </Fragment>
                  ))}
                </PropertyPair>
              </PropertyRow>
            ))}
            {(["cornerRadius", "feather"] as const).map((key) => (
              <PropertyRow
                key={key}
                label={key === "feather" ? "Feather" : "Corner radius"}
                htmlFor={`mask-${i}-${key}`}
              >
                <CommitInput
                  id={`mask-${i}-${key}`}
                  value={m[key]}
                  min={0}
                  max={100}
                  unit="px"
                  disabled={disabled}
                  onCommit={(v) => mask(i, { [key]: Number(v) })}
                />
              </PropertyRow>
            ))}
            <ActionRow>
              <Button
                size="xs"
                variant="ghost"
                disabled={disabled}
                onClick={() =>
                  update({ repairMasks: settings.repairMasks.filter((_, n) => n !== i) })
                }
              >
                <RiDeleteBinLine aria-hidden="true" />
                Remove mask {i + 1}
              </Button>
            </ActionRow>
          </fieldset>
        ))}
        <ActionRow>
          <Button
            size="xs"
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
            <RiAddLine aria-hidden="true" />
            Add repair mask
          </Button>
        </ActionRow>
        {(error || analysis[mediaID]?.error) && (
          <FieldError>{error || analysis[mediaID]?.error}</FieldError>
        )}
      </InspectorSection>
    </>
  );
}
