import { useState } from "react";
import type { Clip, ClipEffect } from "@sidecut/contracts/project";
import {
  effectRegistry,
  effectDefinition,
  resolvedParams,
  renderedEffects,
} from "@sidecut/core/effects";
import { effectsOf } from "@sidecut/core/effect-editing";
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

export function EffectInspector({ clips }: { clips: readonly Clip[] }) {
  const [clipID, setClipID] = useState(clips[0]!.id);
  const clip = clips.find((c) => c.id === clipID) ?? clips[0]!;
  return (
    <section className="editor-trim-form" aria-label="Effects">
      <h3>Effects</h3>
      <Field>
        <FieldLabel htmlFor="effect-clip">Effect clip</FieldLabel>
        <select id="effect-clip" value={clip.id} onChange={(e) => setClipID(e.target.value)}>
          {clips.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name ?? c.id}
            </option>
          ))}
        </select>
      </Field>
      <EffectStack key={clip.id} clip={clip} />
    </section>
  );
}
function EffectStack({ clip }: { clip: Clip }) {
  const { session, snapshot, editor } = useEditorSession();
  const track = [...snapshot.project.videoTracks, ...snapshot.project.audioTracks].find((t) =>
    t.clips.some((c) => c.id === clip.id),
  )!;
  const [type, setType] = useState(track.kind === "video" ? "colorAdjust" : "pitchShift");
  const [error, setError] = useState<string | null>(null);
  const disabled = snapshot.busy || snapshot.readOnly || track.locked;
  const effects = effectsOf(clip, track.kind);
  const apply = (commands: unknown[]) => {
    setError(null);
    try {
      editor.getState().setPlaying(false);
      session.apply({
        label: "Edit effect stack",
        expectedRevision: session.getSnapshot().revision,
        commands,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  return (
    <FieldGroup>
      <FieldDescription>
        Color, sharpen, blur, and pixelate run in list order after the media look. Crop is followed
        by rounded corners, border, transform, shadow, and opacity. The first enabled effect
        supplies each style. Numeric parameters can be animated in Keyframes.
      </FieldDescription>
      <Field>
        <FieldLabel htmlFor="effect-type">Add effect</FieldLabel>
        <select
          id="effect-type"
          value={type}
          disabled={disabled}
          onChange={(e) => setType(e.target.value)}
        >
          {effectRegistry
            .filter((d) => d.domain === track.kind)
            .map((d) => (
              <option key={d.type} value={d.type}>
                {d.name}
                {renderedEffects.has(d.type) ? "" : " (renderer planned)"}
              </option>
            ))}
        </select>
      </Field>
      <Button
        size="xs"
        variant="outline"
        disabled={disabled}
        onClick={() => apply([{ addEffect: { clipID: clip.id, effect: { type } } }])}
      >
        Add effect
      </Button>
      {!effects.length && <p>No effects on this clip.</p>}
      {effects.map((effect, index) => (
        <details key={effect.id}>
          <summary>
            {index + 1}. {effectDefinition(effect.type)?.name ?? effect.type}
            {effect.enabled === false ? " (disabled)" : ""}
          </summary>
          <Field>
            <FieldLabel>
              <input
                type="checkbox"
                checked={effect.enabled !== false}
                disabled={disabled}
                onChange={(e) =>
                  apply([
                    {
                      updateEffect: {
                        clipID: clip.id,
                        effectID: effect.id,
                        patch: { enabled: e.target.checked },
                      },
                    },
                  ])
                }
              />{" "}
              Enabled
            </FieldLabel>
          </Field>
          {!renderedEffects.has(effect.type) && (
            <p>
              This effect is saved. Disable it to preview or export until its renderer is available.
            </p>
          )}
          <div className="editor-clip-edit-actions">
            <Button
              size="xs"
              variant="ghost"
              disabled={disabled || index === 0}
              onClick={() =>
                apply([{ moveEffect: { clipID: clip.id, effectID: effect.id, index: index - 1 } }])
              }
            >
              Move up
            </Button>
            <Button
              size="xs"
              variant="ghost"
              disabled={disabled || index === effects.length - 1}
              onClick={() =>
                apply([{ moveEffect: { clipID: clip.id, effectID: effect.id, index: index + 1 } }])
              }
            >
              Move down
            </Button>
            <Button
              size="xs"
              variant="ghost"
              disabled={disabled}
              onClick={() => apply([{ removeEffect: { clipID: clip.id, effectID: effect.id } }])}
            >
              Remove effect
            </Button>
            <Button
              size="xs"
              variant="ghost"
              disabled={disabled}
              onClick={() => apply([{ removeEffect: { clipID: clip.id, effectID: effect.id } }])}
            >
              Reset effect
            </Button>
          </div>
          <EffectParameters
            key={`${effect.id}:${snapshot.revision}`}
            effect={effect}
            disabled={disabled}
            save={(params) =>
              apply([{ updateEffect: { clipID: clip.id, effectID: effect.id, patch: { params } } }])
            }
          />
        </details>
      ))}
      {error && <FieldError role="alert">{error}</FieldError>}
    </FieldGroup>
  );
}
function EffectParameters({
  effect,
  disabled,
  save,
}: {
  effect: ClipEffect;
  disabled: boolean;
  save: (params: Record<string, unknown>) => void;
}) {
  const { session } = useEditorSession();
  const definition = effectDefinition(effect.type),
    params = resolvedParams(effect);
  const [draft, setDraft] = useState(params);
  const [path, setPath] = useState(String(params.path ?? "")),
    [error, setError] = useState<string | null>(null);
  if (!definition)
    return <pre className="editor-project-json">{JSON.stringify(effect.params, null, 2)}</pre>;
  return (
    <form
      className="editor-trim-form"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget),
          patch: Record<string, unknown> = {};
        for (const p of definition.params) {
          const raw = data.get(p.key);
          patch[p.key] =
            typeof p.defaultValue === "number"
              ? Number(raw)
              : p.kind === "color"
                ? (draft[p.key] ?? p.defaultValue)
                : raw;
        }
        save(patch);
      }}
    >
      <FieldGroup>
        <FieldDescription>{definition.summary}</FieldDescription>
        {effect.type === "lut" && (
          <Field>
            <FieldLabel htmlFor={`lut-${effect.id}`}>Import local .cube file</FieldLabel>
            <Input
              id={`lut-${effect.id}`}
              type="file"
              accept=".cube"
              disabled={disabled}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setError(null);
                try {
                  const name = await session.importLUT(file);
                  setPath(name);
                  save({ path: name });
                } catch (cause) {
                  setError(cause instanceof Error ? cause.message : String(cause));
                }
              }}
            />
            <FieldDescription>
              LUT files stay in this browser. Import them again on another device.
            </FieldDescription>
          </Field>
        )}
        {effect.type === "colorWheels" && (
          <>
            <FieldDescription>
              Drag a wheel to choose hue and strength, or use the numeric fields. Apply parameters
              saves the change.
            </FieldDescription>
            <div className="editor-color-wheels">
              {["shadows", "midtones", "highlights"].map((name) => (
                <div key={name}>
                  <span>{name[0]!.toUpperCase() + name.slice(1)}</span>
                  <button
                    type="button"
                    className="editor-color-wheel"
                    aria-label={`${name} tint wheel`}
                    disabled={disabled}
                    title="Drag to choose tint. Arrow keys change hue; Shift with arrows changes strength. Double-click to clear tint."
                    onPointerDown={(e) => {
                      e.currentTarget.setPointerCapture(e.pointerId);
                      const rect = e.currentTarget.getBoundingClientRect(),
                        x = (e.clientX - rect.left - rect.width / 2) / (rect.width / 2),
                        y = (e.clientY - rect.top - rect.height / 2) / (rect.height / 2);
                      setDraft({
                        ...draft,
                        [name + "Hue"]: Math.round(
                          ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360,
                        ),
                        [name + "Amount"]: Math.round(Math.min(100, Math.hypot(x, y) * 100)),
                      });
                    }}
                    onPointerMove={(e) => {
                      if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
                      const rect = e.currentTarget.getBoundingClientRect(),
                        x = (e.clientX - rect.left - rect.width / 2) / (rect.width / 2),
                        y = (e.clientY - rect.top - rect.height / 2) / (rect.height / 2);
                      setDraft({
                        ...draft,
                        [name + "Hue"]: Math.round(
                          ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360,
                        ),
                        [name + "Amount"]: Math.round(Math.min(100, Math.hypot(x, y) * 100)),
                      });
                    }}
                    onDoubleClick={() =>
                      setDraft({ ...draft, [name + "Hue"]: 0, [name + "Amount"]: 0 })
                    }
                    onKeyDown={(e) => {
                      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key))
                        return;
                      e.preventDefault();
                      const direction = ["ArrowRight", "ArrowUp"].includes(e.key) ? 1 : -1,
                        key = name + (e.shiftKey ? "Amount" : "Hue");
                      setDraft({
                        ...draft,
                        [key]: e.shiftKey
                          ? Math.max(0, Math.min(100, Number(draft[key]) + direction))
                          : (Number(draft[key]) + direction + 360) % 360,
                      });
                    }}
                  >
                    <span
                      className="editor-color-wheel-puck"
                      style={{
                        left: `${50 + (Math.cos((Number(draft[name + "Hue"]) * Math.PI) / 180) * Number(draft[name + "Amount"])) / 2}%`,
                        top: `${50 + (Math.sin((Number(draft[name + "Hue"]) * Math.PI) / 180) * Number(draft[name + "Amount"])) / 2}%`,
                      }}
                    />
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
        <div className="editor-picture-fields">
          {definition.params.map((p) => (
            <Field key={p.key}>
              <FieldLabel htmlFor={`fx-${effect.id}-${p.key}`}>
                {p.name}
                {p.unit ? ` (${p.unit})` : ""}
              </FieldLabel>
              {p.key === "path" ? (
                <Input
                  id={`fx-${effect.id}-${p.key}`}
                  name={p.key}
                  value={path}
                  onChange={(e) => setPath(e.target.value)}
                  disabled={disabled}
                />
              ) : p.kind === "color" ? (
                <EffectColor
                  id={`fx-${effect.id}-${p.key}`}
                  value={draft[p.key] ?? p.defaultValue}
                  fallback={p.defaultValue}
                  disabled={disabled}
                  onChange={(value) => setDraft({ ...draft, [p.key]: value })}
                />
              ) : (
                <Input
                  id={`fx-${effect.id}-${p.key}`}
                  name={p.key}
                  type={typeof p.defaultValue === "number" ? "number" : "text"}
                  value={String(draft[p.key] ?? p.defaultValue)}
                  onChange={(e) => setDraft({ ...draft, [p.key]: e.target.value })}
                  min={p.min}
                  max={p.max}
                  step={p.step ?? "any"}
                  disabled={disabled}
                />
              )}
            </Field>
          ))}
        </div>
        <Button size="xs" variant="outline" type="submit" disabled={disabled}>
          Apply parameters
        </Button>
        {error && <FieldError role="alert">{error}</FieldError>}
      </FieldGroup>
    </form>
  );
}

function EffectColor({
  id,
  value,
  fallback,
  disabled,
  onChange,
}: {
  id: string;
  value: unknown;
  fallback: unknown;
  disabled: boolean;
  onChange: (value: Record<string, number>) => void;
}) {
  const color = value && typeof value === "object" ? (value as Record<string, unknown>) : {},
    base = fallback as Record<string, number>;
  const rgba = Object.fromEntries(
    ["r", "g", "b", "a"].map((key) => [
      key,
      Math.max(0, Math.min(1, typeof color[key] === "number" ? color[key] : (base[key] ?? 1))),
    ]),
  );
  const hex =
    "#" +
    ["r", "g", "b"]
      .map((key) =>
        Math.round(rgba[key]! * 255)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("");
  return (
    <>
      <Input
        id={id}
        type="color"
        value={hex}
        disabled={disabled}
        onChange={(e) =>
          onChange({
            ...rgba,
            ...Object.fromEntries(
              ["r", "g", "b"].map((key, i) => [
                key,
                parseInt(e.target.value.slice(i * 2 + 1, i * 2 + 3), 16) / 255,
              ]),
            ),
          })
        }
      />
      <Field>
        <FieldLabel htmlFor={`${id}-opacity`}>Colour opacity (%)</FieldLabel>
        <Input
          id={`${id}-opacity`}
          type="number"
          min={0}
          max={100}
          step={1}
          value={Math.round(rgba.a! * 100)}
          disabled={disabled}
          onChange={(e) => onChange({ ...rgba, a: Number(e.target.value) / 100 })}
        />
      </Field>
    </>
  );
}
