import { useRef, useState, useSyncExternalStore } from "react";
import type { Clip } from "@sidecut/contracts/project";
import { Button } from "@sidecut/ui/components/button";
import { FieldError } from "@sidecut/ui/components/field";
import { Tip } from "@sidecut/ui/components/tooltip";
import { RiResetLeftLine, RiUploadLine } from "@remixicon/react";
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
import { ActionRow, Hint, InspectorSection, PropertyRow } from "./inspector-layout";
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
  const resetButton = (label: string, onClick: () => void, title?: string) => (
    <Tip label={title ?? label}>
      <Button
        size="icon-xs"
        variant="ghost"
        disabled={disabled}
        aria-label={label}
        onClick={onClick}
      >
        <RiResetLeftLine aria-hidden="true" />
      </Button>
    </Tip>
  );
  const reset = (field: keyof TextStyle) =>
    own(field) &&
    resetButton(
      `Reset ${field}`,
      () => style(field, null),
      `Use the ${preset ? `${preset.name} preset's` : "default"} ${field}`,
    );
  const missing = track
    ? missingFonts(
        { ...snapshot.project, videoTracks: [{ ...track, clips: [clip] }] },
        fontAvailable,
      )[0]
    : undefined;
  const id = (name: string) => `text-${clip.id}-${name}`;
  const select = (field: "alignment" | "uppercase" | "shadow", options: [string, string][]) => (
    <PropertyRow label={field[0]!.toUpperCase() + field.slice(1)} htmlFor={id(field)}>
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
    </PropertyRow>
  );
  const number = (
    field: "size" | "weight" | "strokeWidth" | "lineSpacing",
    label: string,
    max: number,
  ) => (
    <PropertyRow label={label} htmlFor={id(field)}>
      <CommitInput
        id={id(field)}
        value={resolved[field]}
        min={0}
        max={max}
        disabled={disabled}
        onCommit={(v) => style(field, v)}
      />
      {reset(field)}
    </PropertyRow>
  );
  const color = (field: "color" | "strokeColor" | "backgroundColor", label: string) => {
    const value = resolved[field];
    return (
      <PropertyRow label={label} htmlFor={id(field)}>
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
      </PropertyRow>
    );
  };
  return (
    <div className="editor-text-inspector">
      <InspectorSection id="text.title" title="Title">
        <PropertyRow label="Text" htmlFor={id("text")} stacked>
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
        </PropertyRow>
        {content.words && (
          <Hint>Caption text comes from its {content.words.length} timed words.</Hint>
        )}
        <PropertyRow label="Preset" htmlFor={id("preset")}>
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
        </PropertyRow>
        {preset && <Hint>{preset.summary}</Hint>}
      </InspectorSection>
      <InspectorSection id="text.animation" title="Animation">
        {(["animationIn", "animationOut"] as const).map((field) => (
          <PropertyRow
            key={field}
            label={field === "animationIn" ? "In" : "Out"}
            htmlFor={id(field)}
          >
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
          </PropertyRow>
        ))}
        <PropertyRow label="Duration" htmlFor={id("animationDuration")}>
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
          {content.animationDuration !== undefined &&
            resetButton("Reset animation duration", () =>
              patch("Reset title animation duration", { animationDuration: null }),
            )}
        </PropertyRow>
        <Hint>Each animation takes at most half the clip.</Hint>
      </InspectorSection>
      <InspectorSection id="text.font" title="Font">
        <PropertyRow label="Font" htmlFor={id("font")}>
          <CommitInput
            id={id("font")}
            type="text"
            value={resolved.font}
            disabled={disabled}
            onCommit={(v) => style("font", v)}
          />
          {reset("font")}
        </PropertyRow>
        {missing ? (
          <Hint role="status" className="editor-font-warning">
            {missingFontWarning(missing, 1)}
          </Hint>
        ) : (
          <Hint>
            {resolved.font} is available.
            {importedFonts().length > 0 && ` Imported: ${importedFonts().join(", ")}.`}
          </Hint>
        )}
        <ActionRow>
          <Button size="xs" variant="outline" onClick={() => picker.current?.click()}>
            <RiUploadLine aria-hidden="true" />
            Import font file
          </Button>
        </ActionRow>
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
        {status && <Hint role="status">{status}</Hint>}
        {number("size", "Size (pt at 1080p)", 2000)}
        {number("weight", "Weight", 1000)}
        {number("lineSpacing", "Line spacing (× size)", 10)}
        {select("alignment", [
          ["left", "Left"],
          ["center", "Center"],
          ["right", "Right"],
        ])}
        {select("uppercase", [
          ["true", "On"],
          ["false", "Off"],
        ])}
      </InspectorSection>
      <InspectorSection id="text.appearance" title="Appearance">
        {color("color", "Color")}
        {color("strokeColor", "Outline")}
        {number("strokeWidth", "Outline width", 200)}
        {color("backgroundColor", "Box")}
        {select("shadow", [
          ["true", "On"],
          ["false", "Off"],
        ])}
      </InspectorSection>
      {error && <FieldError role="alert">{error}</FieldError>}
    </div>
  );
}
