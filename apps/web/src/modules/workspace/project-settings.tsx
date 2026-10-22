import { useState } from "react";
import { Field, FieldLabel, FieldGroup, FieldError } from "@sidecut/ui/components/field";
import { useEditorSession } from "./editor-session";
import { CommitInput } from "./commit-input";

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
    <section className="editor-inspector-section" aria-labelledby="sequence-title">
      <h3 id="sequence-title">Sequence</h3>
      <FieldGroup>
        {(
          [
            ["speechLoudness", "Speech level", "LUFS", -40, -10],
            ["loudnessTarget", "Export loudness", "LUFS", -40, -5],
            ["truePeakCeiling", "Export peak ceiling", "dBTP", -24, 0],
          ] as const
        ).map(([key, label, unit, min, max]) => (
          <Field key={key}>
            <FieldLabel htmlFor={`setting-${key}`}>{label}</FieldLabel>
            <CommitInput
              id={`setting-${key}`}
              value={project.settings[key]}
              unit={unit}
              min={min}
              max={max}
              disabled={disabled}
              onCommit={(value) => settings({ [key]: value })}
            />
          </Field>
        ))}
        <Field data-disabled={disabled}>
          <FieldLabel htmlFor="sequence-name">Name</FieldLabel>
          <CommitInput
            id="sequence-name"
            type="text"
            value={project.name}
            disabled={disabled}
            onCommit={(name) => apply("Rename sequence", { updateProject: { patch: { name } } })}
          />
        </Field>
        <div className="editor-settings-pair">
          <Field data-disabled={disabled}>
            <FieldLabel htmlFor="canvas-width">Width</FieldLabel>
            <CommitInput
              id="canvas-width"
              value={project.settings.width}
              unit="px"
              min={1}
              step={1}
              disabled={disabled}
              onCommit={(width) => settings({ width: Math.round(Number(width)) })}
            />
          </Field>
          <Field data-disabled={disabled}>
            <FieldLabel htmlFor="canvas-height">Height</FieldLabel>
            <CommitInput
              id="canvas-height"
              value={project.settings.height}
              unit="px"
              min={1}
              step={1}
              disabled={disabled}
              onCommit={(height) => settings({ height: Math.round(Number(height)) })}
            />
          </Field>
        </div>
        <Field data-disabled={disabled}>
          <FieldLabel htmlFor="frame-rate">Frame rate</FieldLabel>
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
        </Field>
        {error && <FieldError role="alert">{error}</FieldError>}
        <p className="text-muted-foreground">
          {project.settings.sampleRate / 1000} kHz audio ·{" "}
          {project.settings.colorSpace === "rec709" ? "Rec.709" : project.settings.colorSpace}
        </p>
      </FieldGroup>
    </section>
  );
}
