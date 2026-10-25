import * as React from "react";
import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import { cn } from "@sidecut/ui/lib/utils";

// One provider per surface: after the first tooltip opens, neighbours open instantly with no animation.
function TooltipProvider({
  delay = 500,
  closeDelay = 0,
  ...props
}: TooltipPrimitive.Provider.Props) {
  return <TooltipPrimitive.Provider delay={delay} closeDelay={closeDelay} {...props} />;
}

function TooltipContent({
  className,
  side = "top",
  sideOffset = 6,
  children,
  ...props
}: TooltipPrimitive.Popup.Props & {
  side?: TooltipPrimitive.Positioner.Props["side"];
  sideOffset?: number;
}) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner
        side={side}
        sideOffset={sideOffset}
        className="pointer-events-none z-50"
      >
        <TooltipPrimitive.Popup
          data-slot="tooltip-content"
          className={cn(
            "dark flex origin-(--transform-origin) items-center gap-2 rounded-md bg-popover px-2 py-1 text-xs font-medium text-popover-foreground shadow-md ring-1 ring-foreground/10 transition-[opacity,scale] duration-125 ease-out data-ending-style:scale-[0.97] data-ending-style:opacity-0 data-instant:duration-0 data-starting-style:scale-[0.97] data-starting-style:opacity-0",
            className,
          )}
          {...props}
        >
          {children}
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  );
}

/** Wraps a single trigger element (usually a Button) with a tooltip label and optional shortcut. */
function Tip({
  label,
  shortcut,
  side,
  children,
}: {
  label: React.ReactNode;
  shortcut?: string;
  side?: TooltipPrimitive.Positioner.Props["side"];
  children: React.ReactElement<Record<string, unknown>>;
}) {
  return (
    // Labels only: the popup never takes the pointer, so it can't block the control it overlaps.
    <TooltipPrimitive.Root disableHoverablePopup>
      <TooltipPrimitive.Trigger render={children} />
      <TooltipContent side={side}>
        <span>{label}</span>
        {shortcut && (
          <kbd className="rounded-sm bg-muted px-1 font-mono text-[10px] text-muted-foreground">
            {shortcut}
          </kbd>
        )}
      </TooltipContent>
    </TooltipPrimitive.Root>
  );
}

const Tooltip = TooltipPrimitive.Root;
const TooltipTrigger = TooltipPrimitive.Trigger;

export { Tip, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger };
