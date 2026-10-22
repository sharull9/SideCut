import { useState } from "react";
import { Input } from "@sidecut/ui/components/input";

// Shows the stored value until focused, then keeps a local draft. Enter or blur saves it;
// Escape restores the stored value. `factor` converts stored units to displayed units
// (0.5 stored with factor 100 shows as 50 %).
export function CommitInput({
  id,
  value,
  onCommit,
  factor = 1,
  unit,
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
  min?: number | undefined;
  max?: number | undefined;
  step?: number | "any";
  disabled?: boolean | undefined;
  type?: "number" | "text";
}) {
  const shown =
    type === "number" ? String(Number((Number(value) * factor).toFixed(4))) : String(value);
  const [draft, setDraft] = useState<string | null>(null);
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
  return (
    <div className="editor-commit-input" data-unit={unit ? "" : undefined}>
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
      {unit && <span aria-hidden="true">{unit}</span>}
    </div>
  );
}
