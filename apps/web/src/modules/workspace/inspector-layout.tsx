import { useId, useState, type ReactNode } from "react";
import { RiArrowDownSLine } from "@remixicon/react";
import { Tip } from "@sidecut/ui/components/tooltip";

// Collapsed sections stay collapsed while switching tabs or clips, but not across reloads.
const collapsed = new Set<string>();

/** Titled, collapsible group inside an inspector tab. Content stays mounted while collapsed. */
export function InspectorSection({
  id,
  title,
  label,
  children,
}: {
  id: string;
  title: string;
  /** Accessible name for the region when it differs from the visible title. */
  label?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(() => !collapsed.has(id));
  const uid = useId();
  const titleID = `${uid}-title`,
    bodyID = `${uid}-body`;
  return (
    <section
      className="editor-section"
      {...(label ? { "aria-label": label } : { "aria-labelledby": titleID })}
    >
      <h3 id={titleID} className="editor-section-title">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyID}
          onClick={() => {
            if (open) collapsed.add(id);
            else collapsed.delete(id);
            setOpen(!open);
          }}
        >
          <RiArrowDownSLine aria-hidden="true" data-open={open} />
          {title}
        </button>
      </h3>
      <div id={bodyID} className="editor-section-body" hidden={!open}>
        {children}
      </div>
    </section>
  );
}

/** Label on the left, control on the right. Without `htmlFor` the label is plain text for a group of controls. */
export function PropertyRow({
  label,
  htmlFor,
  stacked,
  children,
}: {
  label: string;
  htmlFor?: string;
  stacked?: boolean;
  children: ReactNode;
}) {
  const text = <span className="editor-prop-text">{label}</span>;
  const named = label.length > 14 ? <Tip label={label}>{text}</Tip> : text;
  return (
    <div className="editor-prop" data-stacked={stacked ? "" : undefined}>
      {htmlFor ? (
        <label htmlFor={htmlFor} className="editor-prop-label">
          {named}
        </label>
      ) : (
        <span className="editor-prop-label">{named}</span>
      )}
      <div className="editor-prop-control">{children}</div>
    </div>
  );
}

/** Names a compact input whose visible caption is only an axis prefix such as X or L. */
export function HiddenLabel({ htmlFor, children }: { htmlFor: string; children: string }) {
  return (
    <label htmlFor={htmlFor} className="sr-only">
      {children}
    </label>
  );
}

export function PropertyPair({ children }: { children: ReactNode }) {
  return <div className="editor-prop-pair">{children}</div>;
}

/** `ghost` rows hold borderless buttons; the row is pulled left so their text aligns with the labels. */
export function ActionRow({ ghost, children }: { ghost?: boolean; children: ReactNode }) {
  return (
    <div className="editor-actions" data-ghost={ghost ? "" : undefined}>
      {children}
    </div>
  );
}

export function Hint({ className, children, ...props }: React.ComponentProps<"p">) {
  return (
    <p {...props} className={className ? `editor-hint ${className}` : "editor-hint"}>
      {children}
    </p>
  );
}
