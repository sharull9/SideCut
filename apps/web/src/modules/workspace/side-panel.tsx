import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { MediaBin } from "./media-bin";
import { CommentsPanel } from "./comments-panel";
import { HistoryPanel } from "./history-panel";
import { SIDE_TABS, type SideTab } from "./panel-sizes";

const TAB_LABEL: Record<SideTab, string> = {
  media: "Media",
  comments: "Comments",
  history: "History",
};

/** The left column: Media, Comments and History share one panel; switching is instant. */
export function SidePanel({
  tab,
  onTab,
  run,
  hideButton,
}: {
  tab: SideTab;
  onTab: (tab: SideTab) => void;
  run: (action: () => unknown) => void;
  hideButton: ReactNode;
}) {
  const tabs = useRef<HTMLDivElement>(null);
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = SIDE_TABS.indexOf(tab);
    const next =
      event.key === "ArrowRight"
        ? (index + 1) % SIDE_TABS.length
        : event.key === "ArrowLeft"
          ? (index - 1 + SIDE_TABS.length) % SIDE_TABS.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? SIDE_TABS.length - 1
              : -1;
    if (next < 0) return;
    // The window-level arrow handler seeks the playhead unless the key is claimed here.
    event.preventDefault();
    const target = SIDE_TABS[next]!;
    onTab(target);
    tabs.current?.querySelector<HTMLElement>(`#side-tab-${target}`)?.focus();
  }
  let panel: ReactNode;
  if (tab === "comments") panel = <CommentsPanel run={run} hideButton={hideButton} />;
  else if (tab === "history") panel = <HistoryPanel run={run} hideButton={hideButton} />;
  else panel = <MediaBin run={run} hideButton={hideButton} />;
  return (
    <div id="side-panel" className="editor-side-panel">
      <div
        ref={tabs}
        className="editor-side-tabs"
        role="tablist"
        aria-label="Side panels"
        onKeyDown={onKeyDown}
      >
        {SIDE_TABS.map((id) => (
          <button
            key={id}
            id={`side-tab-${id}`}
            type="button"
            role="tab"
            aria-selected={tab === id}
            aria-controls={tab === id ? "side-tabpanel" : undefined}
            tabIndex={tab === id ? 0 : -1}
            onClick={() => onTab(id)}
          >
            {TAB_LABEL[id]}
          </button>
        ))}
      </div>
      <div
        id="side-tabpanel"
        className="editor-side-tabpanel"
        role="tabpanel"
        aria-labelledby={`side-tab-${tab}`}
      >
        {panel}
      </div>
    </div>
  );
}
