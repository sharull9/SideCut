import { useState } from "react";
import { Button } from "@sidecut/ui/components/button";
import { Input } from "@sidecut/ui/components/input";
import { Field, FieldLabel, FieldGroup, FieldError } from "@sidecut/ui/components/field";
import { useEditorSession } from "./editor-session";

export function ProjectSettings() {
  const { session, snapshot } = useEditorSession();
  const { project } = snapshot;
  const [name, setName] = useState(project.name);
  const [width, setWidth] = useState(String(project.settings.width));
  const [height, setHeight] = useState(String(project.settings.height));
  const [numerator, setNumerator] = useState(String(project.settings.frameRate.numerator));
  const [denominator, setDenominator] = useState(String(project.settings.frameRate.denominator));
  const [error, setError] = useState<string | null>(null);
  const disabled = snapshot.readOnly || snapshot.busy;

  return (
    <form
      className="editor-inspector-section"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        try {
          const commands = [];
          if (name !== project.name) commands.push({ updateProject: { patch: { name } } });
          const settings = {
            width: Number(width),
            height: Number(height),
            frameRate: { numerator: Number(numerator), denominator: Number(denominator) },
          };
          if (
            settings.width !== project.settings.width ||
            settings.height !== project.settings.height ||
            settings.frameRate.numerator !== project.settings.frameRate.numerator ||
            settings.frameRate.denominator !== project.settings.frameRate.denominator
          )
            commands.push({ updateSettings: { patch: settings } });
          if (commands.length)
            session.apply({
              label: "Update sequence properties",
              expectedRevision: snapshot.revision,
              commands,
            });
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      }}
    >
      <h3>Sequence properties</h3>
      <FieldGroup>
        <Field data-disabled={disabled}>
          <FieldLabel htmlFor="sequence-name">Name</FieldLabel>
          <Input
            id="sequence-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            disabled={disabled}
          />
        </Field>
        <div className="editor-settings-pair">
          <Field data-disabled={disabled}>
            <FieldLabel htmlFor="canvas-width">Width</FieldLabel>
            <Input
              id="canvas-width"
              type="number"
              min="1"
              step="1"
              value={width}
              onChange={(event) => setWidth(event.target.value)}
              required
              disabled={disabled}
            />
          </Field>
          <Field data-disabled={disabled}>
            <FieldLabel htmlFor="canvas-height">Height</FieldLabel>
            <Input
              id="canvas-height"
              type="number"
              min="1"
              step="1"
              value={height}
              onChange={(event) => setHeight(event.target.value)}
              required
              disabled={disabled}
            />
          </Field>
        </div>
        <div className="editor-settings-pair">
          <Field data-disabled={disabled}>
            <FieldLabel htmlFor="fps-numerator">FPS numerator</FieldLabel>
            <Input
              id="fps-numerator"
              type="number"
              min="1"
              step="1"
              value={numerator}
              onChange={(event) => setNumerator(event.target.value)}
              required
              disabled={disabled}
            />
          </Field>
          <Field data-disabled={disabled}>
            <FieldLabel htmlFor="fps-denominator">FPS denominator</FieldLabel>
            <Input
              id="fps-denominator"
              type="number"
              min="1"
              step="1"
              value={denominator}
              onChange={(event) => setDenominator(event.target.value)}
              required
              disabled={disabled}
            />
          </Field>
        </div>
        {error && <FieldError>{error}</FieldError>}
        <Button type="submit" variant="outline" size="sm" disabled={disabled}>
          Apply properties
        </Button>
        <p className="text-muted-foreground">
          {project.settings.sampleRate / 1000} kHz audio ·{" "}
          {project.settings.colorSpace === "rec709" ? "Rec.709" : project.settings.colorSpace}
        </p>
      </FieldGroup>
    </form>
  );
}
