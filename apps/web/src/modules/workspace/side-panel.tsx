import {
  Suspense,
  lazy,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { MediaBin } from "./media-bin";
import { CommentsPanel } from "./comments-panel";
import { HistoryPanel } from "./history-panel";
import { assistantBridge } from "./assistant-bridge";
import { SIDE_TABS, type SideTab } from "./panel-sizes";

// The eve client loads only when the Assistant tab first opens.
const AssistantPanel = lazy(() =>
  import("./assistant-panel").then((module) => ({ default: module.AssistantPanel })),
);

const TAB_LABEL: Record<SideTab, string> = {
  media: "Media",
  comments: "Comments",
  history: "History",
  assistant: "Assistant",
};

/** The left column: Media, Comments and History share one panel; switching is instant. */
export function SidePanel({
  tab: requested,
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
  // The assistant runs beside the desktop host, so the browser build has no Assistant tab.
  // Checked after mount so prerendered markup and the first client render agree.
  const [hasAssistant, setHasAssistant] = useState(false);
  useEffect(() => setHasAssistant(Boolean(assistantBridge())), []);
  const visible = SIDE_TABS.filter((id) => id !== "assistant" || hasAssistant);
  const tab = visible.includes(requested) ? requested : "media";
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = visible.indexOf(tab);
    const next =
      event.key === "ArrowRight"
        ? (index + 1) % visible.length
        : event.key === "ArrowLeft"
          ? (index - 1 + visible.length) % visible.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? visible.length - 1
              : -1;
    if (next < 0) return;
    // The window-level arrow handler seeks the playhead unless the key is claimed here.
    event.preventDefault();
    const target = visible[next]!;
    onTab(target);
    tabs.current?.querySelector<HTMLElement>(`#side-tab-${target}`)?.focus();
  }
  let panel: ReactNode;
  if (tab === "comments") panel = <CommentsPanel run={run} hideButton={hideButton} />;
  else if (tab === "history") panel = <HistoryPanel run={run} hideButton={hideButton} />;
  else if (tab === "assistant")
    panel = (
      <Suspense fallback={<p role="status">Loading the assistant…</p>}>
        <AssistantPanel hideButton={hideButton} />
      </Suspense>
    );
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
        {visible.map((id) => (
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
