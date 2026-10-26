import type { ComponentProps } from "react";
import { ContextMenu as Primitive } from "@base-ui/react/context-menu";
import { cn } from "cn";

export const ContextMenu = Primitive.Root;
export const ContextMenuTrigger = Primitive.Trigger;
export const ContextMenuGroup = Primitive.Group;

export function ContextMenuContent({
  className,
  ...props
}: ComponentProps<typeof Primitive.Popup>) {
  return (
    <Primitive.Portal>
      <Primitive.Positioner className="z-50" sideOffset={4}>
        <Primitive.Popup
          className={cn(
            "dark min-w-48 rounded-md bg-popover p-1 font-sans text-xs text-popover-foreground shadow-lg outline-none ring-1 ring-foreground/10",
            className,
          )}
          {...props}
        />
      </Primitive.Positioner>
    </Primitive.Portal>
  );
}

export function ContextMenuItem({ className, ...props }: ComponentProps<typeof Primitive.Item>) {
  return (
    <Primitive.Item
      className={cn(
        "flex min-h-8 cursor-default items-center gap-3 rounded-sm px-2 outline-none select-none data-disabled:pointer-events-none data-disabled:opacity-50 data-highlighted:bg-accent data-highlighted:text-accent-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function ContextMenuSeparator(props: ComponentProps<typeof Primitive.Separator>) {
  return <Primitive.Separator className="mx-1 my-1 h-px bg-border" {...props} />;
}
