import { useState } from "react";
import type { Clip, ClipEffect } from "@sidecut/contracts/project";
import {
  effectRegistry,
  effectDefinition,
  resolvedParams,
  renderedEffects,
  styleEffects,
} from "@sidecut/core/effects";
import { effectsOf } from "@sidecut/core/effect-editing";
import { Button } from "@sidecut/ui/components/button";
import { Input } from "@sidecut/ui/components/input";
import { FieldError } from "@sidecut/ui/components/field";
import {
  RiAddLine,
  RiArrowDownLine,
  RiArrowUpLine,
  RiDeleteBinLine,
  RiResetLeftLine,
} from "@remixicon/react";
import { Tip } from "@sidecut/ui/components/tooltip";
import { useEditorSession } from "./editor-session";
import { ActionRow, Hint, InspectorSection, PropertyRow } from "./inspector-layout";

export function EffectInspector({ clips }: { clips: readonly Clip[] }) {
  const [clipID, setClipID] = useState(clips[0]!.id);
  const clip = clips.find((c) => c.id === clipID) ?? clips[0]!;
  return (
    <InspectorSection id="effects.stack" title="Effects" label="Effects">
      {clips.length > 1 && (
        <PropertyRow label="Clip" htmlFor="effect-clip">
          <select id="effect-clip" value={clip.id} onChange={(e) => setClipID(e.target.value)}>
            {clips.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name ?? c.id}
              </option>
            ))}
          </select>
        </PropertyRow>
      )}
      <EffectStack key={clip.id} clip={clip} />
    </InspectorSection>
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
    <>
      <Hint>
        {clip.content.adjustment != null
          ? "Effects change every layer below this track, top to bottom. Animate numeric settings under Keyframes."
          : track.kind === "audio"
            ? "The first active pitch shift changes pitch. Dynamics run top to bottom, before gain animation and fades."
            : "Effects run top to bottom. Animate numeric settings under Keyframes."}
      </Hint>
      <PropertyRow label="Add effect" htmlFor="effect-type">
        <select
          id="effect-type"
          value={type}
          disabled={disabled}
          onChange={(e) => setType(e.target.value)}
        >
          {effectRegistry
            .filter(
              (d) =>
                d.domain === track.kind &&
                (clip.content.adjustment == null || !styleEffects.has(d.type)),
            )
            .map((d) => (
              <option key={d.type} value={d.type}>
                {d.name}
                {renderedEffects.has(d.type) ? "" : " (renderer planned)"}
              </option>
            ))}
        </select>
      </PropertyRow>
      <ActionRow>
        <Button
          size="xs"
          variant="outline"
          disabled={disabled}
          onClick={() => apply([{ addEffect: { clipID: clip.id, effect: { type } } }])}
        >
          <RiAddLine aria-hidden="true" />
          Add effect
        </Button>
      </ActionRow>
      {!effects.length && <Hint>No effects on this clip.</Hint>}
      {effects.map((effect, index) => (
        <details key={effect.id} className="editor-effect">
          <summary>
            {index + 1}. {effectDefinition(effect.type)?.name ?? effect.type}
            {effect.enabled === false ? " (disabled)" : ""}
          </summary>
          <div className="editor-effect-body">
            <label className="editor-check">
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
            </label>
            {!renderedEffects.has(effect.type) && (
              <Hint>
                This effect is saved. Disable it to preview or export until its renderer is
                available.
              </Hint>
            )}
            <ActionRow>
              {(
                [
                  [
                    "Move up",
                    RiArrowUpLine,
                    index === 0,
                    { moveEffect: { clipID: clip.id, effectID: effect.id, index: index - 1 } },
                  ],
                  [
                    "Move down",
                    RiArrowDownLine,
                    index === effects.length - 1,
                    { moveEffect: { clipID: clip.id, effectID: effect.id, index: index + 1 } },
                  ],
                  [
                    "Remove effect",
                    RiDeleteBinLine,
                    false,
                    { removeEffect: { clipID: clip.id, effectID: effect.id } },
                  ],
                  [
                    "Reset effect",
                    RiResetLeftLine,
                    false,
                    { removeEffect: { clipID: clip.id, effectID: effect.id } },
                  ],
                ] as const
              ).map(([label, Icon, off, command]) => (
                <Tip key={label} label={label}>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label={label}
                    disabled={disabled || off}
                    onClick={() => apply([command])}
                  >
                    <Icon aria-hidden="true" />
                  </Button>
                </Tip>
              ))}
            </ActionRow>
            <EffectParameters
              key={`${effect.id}:${snapshot.revision}`}
              effect={effect}
              disabled={disabled}
              save={(params) =>
                apply([
                  { updateEffect: { clipID: clip.id, effectID: effect.id, patch: { params } } },
                ])
              }
            />
          </div>
        </details>
      ))}
      {error && <FieldError role="alert">{error}</FieldError>}
    </>
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
      className="editor-section-form"
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
      <>
        <Hint>{definition.summary}</Hint>
        {effect.type === "lut" && (
          <>
            <PropertyRow label="Import local .cube file" htmlFor={`lut-${effect.id}`} stacked>
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
            </PropertyRow>
            <Hint>LUT files stay in this browser. Import them again on another device.</Hint>
          </>
        )}
        {effect.type === "colorWheels" && (
          <>
            <Hint>
              Drag a wheel to choose hue and strength, or use the numeric fields. Apply parameters
              saves the change.
            </Hint>
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
        {definition.params.map((p) =>
          p.kind === "color" && p.key !== "path" ? (
            <EffectColor
              key={p.key}
              id={`fx-${effect.id}-${p.key}`}
              label={`${p.name}${p.unit ? ` (${p.unit})` : ""}`}
              value={draft[p.key] ?? p.defaultValue}
              fallback={p.defaultValue}
              disabled={disabled}
              onChange={(value) => setDraft({ ...draft, [p.key]: value })}
            />
          ) : (
            <PropertyRow
              key={p.key}
              label={`${p.name}${p.unit ? ` (${p.unit})` : ""}`}
              htmlFor={`fx-${effect.id}-${p.key}`}
            >
              {p.key === "path" ? (
                <Input
                  id={`fx-${effect.id}-${p.key}`}
                  name={p.key}
                  value={path}
                  onChange={(e) => setPath(e.target.value)}
                  disabled={disabled}
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
            </PropertyRow>
          ),
        )}
        <ActionRow>
          <Button size="xs" variant="outline" type="submit" disabled={disabled}>
            Apply parameters
          </Button>
        </ActionRow>
        {error && <FieldError role="alert">{error}</FieldError>}
      </>
    </form>
  );
}

function EffectColor({
  id,
  label,
  value,
  fallback,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
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
      <PropertyRow label={label} htmlFor={id}>
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
      </PropertyRow>
      <PropertyRow label="Colour opacity (%)" htmlFor={`${id}-opacity`}>
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
      </PropertyRow>
    </>
  );
}
