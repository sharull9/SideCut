import { useRef, useState, useSyncExternalStore } from "react";
import type { Clip } from "@sidecut/contracts/project";
import { Button } from "@sidecut/ui/components/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@sidecut/ui/components/field";
import {
  ANIMATION_NAMES,
  DEFAULT_ANIMATION_DURATION,
  TITLE_PRESETS,
  missingFontWarning,
  missingFonts,
  presetFor,
  presetStyle,
  styleFor,
  textContent,
  type RGBA,
  type TextStyle,
} from "@sidecut/core/text";
import {
  fontAvailable,
  importFont,
  importedFonts,
  subscribeFonts,
} from "@sidecut/platform-browser/text";
import { CommitInput } from "./commit-input";
import { useEditorSession } from "./editor-session";

let fontVersion = 0;
const fontsChanged = (listener: () => void) =>
  subscribeFonts(() => {
    fontVersion++;
    listener();
  });
/** Rerenders when fonts are imported, restored, or loaded. */
export const useFontVersion = () =>
  useSyncExternalStore(
    fontsChanged,
    () => fontVersion,
    () => fontVersion,
  );

const hex = (c: RGBA) =>
  `#${[c.r, c.g, c.b]
    .map((v) =>
      Math.round(v * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
const rgba = (value: string, a = 1): RGBA => ({
  r: parseInt(value.slice(1, 3), 16) / 255,
  g: parseInt(value.slice(3, 5), 16) / 255,
  b: parseInt(value.slice(5, 7), 16) / 255,
  a,
});

export function TextInspector({ clip }: { clip: Clip }) {
  const { session, snapshot } = useEditorSession();
  useFontVersion();
  const picker = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null),
    [status, setStatus] = useState<string | null>(null);
  let content;
  try {
    content = textContent(clip);
  } catch (cause) {
    return (
      <FieldError role="alert">{cause instanceof Error ? cause.message : String(cause)}</FieldError>
    );
  }
  if (!content) return null;
  const track = snapshot.project.videoTracks.find((t) => t.clips.some((c) => c.id === clip.id));
  const disabled = snapshot.readOnly || snapshot.busy || track?.locked === true;
  const resolved = styleFor(content),
    fromPreset = presetStyle(content.preset),
    preset = presetFor(content.preset);
  const patch = (label: string, text: Record<string, unknown>) => {
    setError(null);
    try {
      session.apply({
        label,
        expectedRevision: snapshot.revision,
        commands: [{ updateClip: { clipID: clip.id, patch: { content: { text } } } }],
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const style = (field: keyof TextStyle, value: unknown) =>
    patch(value == null ? `Reset title ${field}` : `Set title ${field}`, {
      style: { [field]: value },
    });
  const own = (field: keyof TextStyle) => content.style[field] !== undefined;
  const reset = (field: keyof TextStyle) =>
    own(field) && (
      <Button
        size="xs"
        variant="ghost"
        disabled={disabled}
        onClick={() => style(field, null)}
        title={`Use the ${preset ? `${preset.name} preset's` : "default"} ${field}`}
      >
        Reset
      </Button>
    );
  const missing = track
    ? missingFonts(
        { ...snapshot.project, videoTracks: [{ ...track, clips: [clip] }] },
        fontAvailable,
      )[0]
    : undefined;
  const id = (name: string) => `text-${clip.id}-${name}`;
  const select = (field: "alignment" | "uppercase" | "shadow", options: [string, string][]) => (
    <Field orientation="horizontal">
      <FieldLabel htmlFor={id(field)}>{field[0]!.toUpperCase() + field.slice(1)}</FieldLabel>
      <select
        id={id(field)}
        disabled={disabled}
        value={content.style[field] === undefined ? "" : String(content.style[field])}
        onChange={(event) => {
          const v = event.target.value;
          style(field, v === "" ? null : field === "alignment" ? v : v === "true");
        }}
      >
        <option value="">Preset ({String(fromPreset[field])})</option>
        {options.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
    </Field>
  );
  const number = (
    field: "size" | "weight" | "strokeWidth" | "lineSpacing",
    label: string,
    max: number,
  ) => (
    <Field orientation="horizontal">
      <FieldLabel htmlFor={id(field)}>{label}</FieldLabel>
      <CommitInput
        id={id(field)}
        value={resolved[field]}
        min={0}
        max={max}
        disabled={disabled}
        onCommit={(v) => style(field, v)}
      />
      {reset(field)}
    </Field>
  );
  const color = (field: "color" | "strokeColor" | "backgroundColor", label: string) => {
    const value = resolved[field];
    return (
      <Field orientation="horizontal">
        <FieldLabel htmlFor={id(field)}>{label}</FieldLabel>
        <input
          id={id(field)}
          type="color"
          disabled={disabled}
          value={hex(value ?? { r: 0, g: 0, b: 0, a: 1 })}
          onChange={(event) => style(field, rgba(event.target.value))}
        />
        {field !== "color" && value && (
          <Button
            size="xs"
            variant="ghost"
            disabled={disabled}
            onClick={() => style(field, { r: 0, g: 0, b: 0, a: 0 })}
          >
            None
          </Button>
        )}
        {reset(field)}
      </Field>
    );
  };
  return (
    <div className="editor-trim-form editor-text-inspector">
      <h3>Title</h3>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor={id("text")}>Text</FieldLabel>
          <textarea
            key={`${clip.id}:${content.text}`}
            id={id("text")}
            className="editor-text-area"
            rows={3}
            disabled={disabled || !!content.words}
            defaultValue={content.text}
            onBlur={(event) => {
              if (event.target.value !== content.text)
                patch("Edit title text", { text: event.target.value });
            }}
          />
          {content.words && (
            <FieldDescription>
              Caption text comes from its {content.words.length} timed words.
            </FieldDescription>
          )}
        </Field>
        <Field orientation="horizontal">
          <FieldLabel htmlFor={id("preset")}>Preset</FieldLabel>
          <select
            id={id("preset")}
            disabled={disabled}
            value={preset?.id ?? content.preset ?? ""}
            onChange={(event) =>
              patch("Change title preset", { preset: event.target.value || null })
            }
          >
            <option value="">None</option>
            {TITLE_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
            {content.preset && !preset && (
              <option value={content.preset}>{content.preset} (unknown)</option>
            )}
          </select>
        </Field>
        {preset && <FieldDescription>{preset.summary}</FieldDescription>}
      </FieldGroup>
      <h3>Animation</h3>
      <FieldGroup>
        {(["animationIn", "animationOut"] as const).map((field) => (
          <Field key={field} orientation="horizontal">
            <FieldLabel htmlFor={id(field)}>{field === "animationIn" ? "In" : "Out"}</FieldLabel>
            <select
              id={id(field)}
              disabled={disabled}
              value={content[field] ?? ""}
              onChange={(event) =>
                patch(`Set title ${field === "animationIn" ? "in" : "out"} animation`, {
                  [field]: event.target.value || null,
                })
              }
            >
              <option value="">Preset ({preset?.[field] ?? "none"})</option>
              {ANIMATION_NAMES.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </Field>
        ))}
        <Field orientation="horizontal">
          <FieldLabel htmlFor={id("animationDuration")}>Duration</FieldLabel>
          <CommitInput
            id={id("animationDuration")}
            value={
              content.animationDuration ?? preset?.animationDuration ?? DEFAULT_ANIMATION_DURATION
            }
            min={0}
            max={10}
            unit="s"
            disabled={disabled}
            onCommit={(v) => patch("Set title animation duration", { animationDuration: v })}
          />
          {content.animationDuration !== undefined && (
            <Button
              size="xs"
              variant="ghost"
              disabled={disabled}
              onClick={() => patch("Reset title animation duration", { animationDuration: null })}
            >
              Reset
            </Button>
          )}
        </Field>
        <FieldDescription>Each animation takes at most half the clip.</FieldDescription>
      </FieldGroup>
      <h3>Style</h3>
      <FieldGroup>
        <Field orientation="horizontal">
          <FieldLabel htmlFor={id("font")}>Font</FieldLabel>
          <CommitInput
            id={id("font")}
            type="text"
            value={resolved.font}
            disabled={disabled}
            onCommit={(v) => style("font", v)}
          />
          {reset("font")}
        </Field>
        {missing ? (
          <FieldDescription role="status" className="editor-font-warning">
            {missingFontWarning(missing, 1)}
          </FieldDescription>
        ) : (
          <FieldDescription>
            {resolved.font} is available.
            {importedFonts().length > 0 && ` Imported: ${importedFonts().join(", ")}.`}
          </FieldDescription>
        )}
        <Field orientation="horizontal">
          <Button size="xs" variant="outline" onClick={() => picker.current?.click()}>
            Import font file
          </Button>
          <input
            ref={picker}
            type="file"
            accept=".ttf,.otf,.woff,.woff2"
            className="sr-only"
            tabIndex={-1}
            aria-label="Font file"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              setError(null);
              importFont(file)
                .then((family) => setStatus(`Imported ${family}. It stays on this device.`))
                .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
            }}
          />
        </Field>
        {status && <p role="status">{status}</p>}
        {number("size", "Size (pt at 1080p)", 2000)}
        {number("weight", "Weight", 1000)}
        {color("color", "Color")}
        {color("strokeColor", "Outline")}
        {number("strokeWidth", "Outline width", 200)}
        {color("backgroundColor", "Box")}
        {select("alignment", [
          ["left", "Left"],
          ["center", "Center"],
          ["right", "Right"],
        ])}
        {select("uppercase", [
          ["true", "On"],
          ["false", "Off"],
        ])}
        {select("shadow", [
          ["true", "On"],
          ["false", "Off"],
        ])}
        {number("lineSpacing", "Line spacing (× size)", 10)}
      </FieldGroup>
      {error && <FieldError role="alert">{error}</FieldError>}
    </div>
  );
}
