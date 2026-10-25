import type { ReactNode } from "react";
import { Tip } from "@sidecut/ui/components/tooltip";

export const MOD =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";

/** Tooltip around a control that may be disabled: the span keeps receiving hover and focus. */
export function ToolTip({
  label,
  shortcut,
  children,
}: {
  label: string;
  shortcut?: string;
  children: ReactNode;
}) {
  return (
    <Tip label={label} {...(shortcut ? { shortcut } : {})}>
      <span className="editor-tip-target">{children}</span>
    </Tip>
  );
}
