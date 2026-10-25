import { useEffect, useRef, useState } from "react";
import { Input } from "@sidecut/ui/components/input";

const SCRUB_PIXELS_PER_STEP = 4;

// Shows the stored value until focused, then keeps a local draft. Enter or blur saves it;
// Escape restores the stored value. `factor` converts stored units to displayed units
// (0.5 stored with factor 100 shows as 50 %). A numeric `prefix` doubles as a scrub handle:
// drag it sideways to change the value (Shift x10, Alt x0.1); release saves, Escape cancels.
export function CommitInput({
  id,
  value,
  onCommit,
  factor = 1,
  unit,
  prefix,
  min,
  max,
  step = "any",
  disabled,
  type = "number",
}: {
  id: string;
  value: number | string;
  onCommit: (value: number | string) => void;
  factor?: number;
  unit?: string | undefined;
  prefix?: string | undefined;
  min?: number | undefined;
  max?: number | undefined;
  step?: number | "any";
  disabled?: boolean | undefined;
  type?: "number" | "text";
}) {
  const shown =
    type === "number" ? String(Number((Number(value) * factor).toFixed(4))) : String(value);
  const [draft, setDraft] = useState<string | null>(null);
  const [scrubbing, setScrubbing] = useState(false);
  const scrub = useRef<{ x: number; from: number; stop: () => void } | null>(null);
  useEffect(() => () => scrub.current?.stop(), []);
  const commit = (text: string) => {
    setDraft(null);
    if (text === shown) return;
    if (type === "text") {
      if (text.trim()) onCommit(text.trim());
      return;
    }
    const number = Number(text);
    if (text.trim() === "" || !Number.isFinite(number)) return;
    const clamped = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, number));
    onCommit(clamped / factor);
  };
  const scrubbable = prefix != null && type === "number" && !disabled;
  const scrubValue = (
    state: { x: number; from: number },
    event: { clientX: number; shiftKey: boolean; altKey: boolean },
  ) => {
    const unitStep = (step === "any" ? 1 : step) * (event.shiftKey ? 10 : event.altKey ? 0.1 : 1);
    const next =
      state.from + Math.round((event.clientX - state.x) / SCRUB_PIXELS_PER_STEP) * unitStep;
    return String(Number(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, next)).toFixed(4)));
  };
  const endScrub = () => {
    scrub.current?.stop();
    scrub.current = null;
    setScrubbing(false);
  };
  return (
    <div
      className="editor-commit-input"
      data-unit={unit ? "" : undefined}
      data-prefix={prefix != null ? "" : undefined}
    >
      {prefix != null && (
        <span
          aria-hidden="true"
          className="editor-commit-prefix"
          data-scrub={scrubbable ? "" : undefined}
          data-active={scrubbing ? "" : undefined}
          onPointerDown={(event) => {
            if (!scrubbable || event.button !== 0) return;
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            const prior = draft;
            const onKey = (key: KeyboardEvent) => {
              if (key.key !== "Escape") return;
              key.preventDefault();
              key.stopPropagation();
              endScrub();
              setDraft(prior);
            };
            window.addEventListener("keydown", onKey, true);
            scrub.current = {
              x: event.clientX,
              from: Number(draft ?? shown),
              stop: () => window.removeEventListener("keydown", onKey, true),
            };
            setScrubbing(true);
          }}
          onPointerMove={(event) => {
            if (scrub.current) setDraft(scrubValue(scrub.current, event));
          }}
          onPointerUp={(event) => {
            const state = scrub.current;
            if (!state) return;
            endScrub();
            commit(scrubValue(state, event));
          }}
          onPointerCancel={() => {
            if (!scrub.current) return;
            endScrub();
            setDraft(null);
          }}
        >
          {prefix}
        </span>
      )}
      <Input
        id={id}
        type={type}
        inputMode={type === "number" ? "decimal" : undefined}
        step={type === "number" ? step : undefined}
        min={min}
        max={max}
        disabled={disabled}
        value={draft ?? shown}
        onFocus={() => setDraft(shown)}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={(event) => commit(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit(event.currentTarget.value);
          if (event.key === "Escape") {
            event.preventDefault();
            setDraft(shown);
          }
        }}
      />
      {unit && (
        <span aria-hidden="true" className="editor-commit-unit">
          {unit}
        </span>
      )}
    </div>
  );
}
