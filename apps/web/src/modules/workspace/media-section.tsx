import type { ReactNode } from "react";
import { RiArrowDownSLine } from "@remixicon/react";

/** Collapsed-by-default disclosure with a header row: icon, title, count and chevron. */
export function MediaSection({
  icon,
  title,
  count,
  children,
}: {
  icon: ReactNode;
  title: string;
  count?: number;
  children: ReactNode;
}) {
  return (
    <details className="editor-local-library editor-media-section">
      <summary>
        {icon}
        <span>{title}</span>
        {count !== undefined && <small>{count}</small>}
        <RiArrowDownSLine aria-hidden="true" className="editor-media-section-chevron" />
      </summary>
      <div className="editor-trim-form">{children}</div>
    </details>
  );
}
