import { useState } from "react";
import { FieldError } from "@sidecut/ui/components/field";
import { useEditorSession } from "./editor-session";
import { CommitInput } from "./commit-input";
import { HiddenLabel, Hint, InspectorSection, PropertyPair, PropertyRow } from "./inspector-layout";

const FRAME_RATES = [
  [24000, 1001, "23.976"],
  [24, 1, "24"],
  [25, 1, "25"],
  [30000, 1001, "29.97"],
  [30, 1, "30"],
  [50, 1, "50"],
  [60000, 1001, "59.94"],
  [60, 1, "60"],
] as const;

export function ProjectSettings() {
  const { session, snapshot } = useEditorSession();
  const { project } = snapshot;
  const [error, setError] = useState<string | null>(null);
  const disabled = snapshot.readOnly || snapshot.busy;
  const rate = project.settings.frameRate;
  const rates = FRAME_RATES.some(([n, d]) => n === rate.numerator && d === rate.denominator)
    ? FRAME_RATES
    : [
        ...FRAME_RATES,
        [
          rate.numerator,
          rate.denominator,
          String(Number((rate.numerator / rate.denominator).toFixed(3))),
        ] as const,
      ];
  const apply = (label: string, command: unknown) => {
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
  const settings = (patch: Record<string, unknown>) =>
    apply("Update sequence properties", { updateSettings: { patch } });

  return (
    <div className="editor-sequence-settings">
      <InspectorSection id="sequence.sequence" title="Sequence">
        <PropertyRow label="Name" htmlFor="sequence-name">
          <CommitInput
            id="sequence-name"
            type="text"
            value={project.name}
            disabled={disabled}
            onCommit={(name) => apply("Rename sequence", { updateProject: { patch: { name } } })}
          />
        </PropertyRow>
        <PropertyRow label="Canvas">
          <PropertyPair>
            <HiddenLabel htmlFor="canvas-width">Width</HiddenLabel>
            <CommitInput
              id="canvas-width"
              value={project.settings.width}
              unit="px"
              prefix="W"
              min={1}
              step={1}
              disabled={disabled}
              onCommit={(width) => settings({ width: Math.round(Number(width)) })}
            />
            <HiddenLabel htmlFor="canvas-height">Height</HiddenLabel>
            <CommitInput
              id="canvas-height"
              value={project.settings.height}
              unit="px"
              prefix="H"
              min={1}
              step={1}
              disabled={disabled}
              onCommit={(height) => settings({ height: Math.round(Number(height)) })}
            />
          </PropertyPair>
        </PropertyRow>
        <PropertyRow label="Frame rate" htmlFor="frame-rate">
          <select
            id="frame-rate"
            disabled={disabled}
            value={`${rate.numerator}/${rate.denominator}`}
            onChange={(event) => {
              const [numerator, denominator] = event.target.value.split("/").map(Number);
              settings({ frameRate: { numerator, denominator } });
            }}
          >
            {rates.map(([numerator, denominator, label]) => (
              <option key={label} value={`${numerator}/${denominator}`}>
                {label} fps
              </option>
            ))}
          </select>
        </PropertyRow>
        <Hint>
          {project.settings.sampleRate / 1000} kHz audio ·{" "}
          {project.settings.colorSpace === "rec709" ? "Rec.709" : project.settings.colorSpace}
        </Hint>
      </InspectorSection>
      <InspectorSection id="sequence.loudness" title="Loudness">
        {(
          [
            ["speechLoudness", "Speech level", "LUFS", -40, -10],
            ["loudnessTarget", "Export loudness", "LUFS", -40, -5],
            ["truePeakCeiling", "Export peak ceiling", "dBTP", -24, 0],
          ] as const
        ).map(([key, label, unit, min, max]) => (
          <PropertyRow key={key} label={label} htmlFor={`setting-${key}`}>
            <CommitInput
              id={`setting-${key}`}
              value={project.settings[key]}
              unit={unit}
              min={min}
              max={max}
              disabled={disabled}
              onCommit={(value) => settings({ [key]: value })}
            />
          </PropertyRow>
        ))}
      </InspectorSection>
      {error && <FieldError role="alert">{error}</FieldError>}
    </div>
  );
}
