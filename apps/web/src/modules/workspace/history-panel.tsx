import { useEffect, useState, type ReactNode } from "react";
import {
  RiArrowGoBackLine,
  RiArrowGoForwardLine,
  RiCheckDoubleLine,
  RiHistoryLine,
  RiRobot2Line,
  RiUser3Line,
} from "@remixicon/react";
import { Button } from "@sidecut/ui/components/button";
import { Tip } from "@sidecut/ui/components/tooltip";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from "@sidecut/ui/components/empty";
import { useEditorSession } from "./editor-session";
import type { HistoryEntry } from "./browser-session";

const LOCAL_AUTHORS = ["user", "human"];
const dayFormat = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
});
const fullFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "medium" });
const relativeFormat = new Intl.RelativeTimeFormat(undefined, { numeric: "auto", style: "short" });

function relativeTime(date: Date, now: number) {
  const seconds = Math.round((date.getTime() - now) / 1000);
  if (Math.abs(seconds) < 45) return "just now";
  for (const [unit, size] of [
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ] as const)
    if (Math.abs(seconds) >= size) return relativeFormat.format(Math.round(seconds / size), unit);
  return "just now";
}

function dayLabel(date: Date | null, now: number) {
  if (!date) return "Earlier";
  const start = (value: Date | number) => new Date(value).setHours(0, 0, 0, 0);
  const days = Math.round((start(now) - start(date)) / 86400000);
  return days === 0 ? "Today" : days === 1 ? "Yesterday" : dayFormat.format(date);
}

/** Changes in the project, newest first, grouped by day. Read-only apart from undo and redo. */
export function HistoryPanel({
  run,
  hideButton,
}: {
  run: (action: () => unknown) => void;
  hideButton?: ReactNode;
}) {
  const { session, snapshot } = useEditorSession();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const locked = snapshot.readOnly || snapshot.busy;
  const pending = snapshot.reviewPendingCount ?? 0;
  // The panel re-renders on every snapshot, so the journal is always read at the current revision.
  const history = session.history();
  const entries = [...history.entries].reverse();
  // Review counts every non-local entry after the reviewed revision, newest last.
  const awaiting = new Set<string>();
  for (const entry of entries) {
    if (awaiting.size >= pending) break;
    if (!LOCAL_AUTHORS.includes(entry.author)) awaiting.add(entry.id);
  }
  const groups: { label: string; entries: HistoryEntry[] }[] = [];
  for (const entry of entries) {
    const label = dayLabel(entry.date ? new Date(entry.date) : null, now);
    const last = groups.at(-1);
    if (last?.label === label) last.entries.push(entry);
    else groups.push({ label, entries: [entry] });
  }

  return (
    <section aria-labelledby="history-title" className="editor-panel editor-side-section">
      <div className="editor-panel-heading">
        <h2 id="history-title">History</h2>
        {entries.length > 0 && <span>{entries.length}</span>}
        <Tip
          label={snapshot.undoLabel ? `Undo ${snapshot.undoLabel}` : "Nothing to undo"}
          shortcut="Ctrl+Z"
        >
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Undo last change"
            disabled={locked || !snapshot.undoLabel}
            onClick={() => run(() => session.undo())}
          >
            <RiArrowGoBackLine aria-hidden="true" />
          </Button>
        </Tip>
        <Tip
          label={snapshot.redoLabel ? `Redo ${snapshot.redoLabel}` : "Nothing to redo"}
          shortcut="Ctrl+Shift+Z"
        >
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Redo last change"
            disabled={locked || !snapshot.redoLabel}
            onClick={() => run(() => session.redo())}
          >
            <RiArrowGoForwardLine aria-hidden="true" />
          </Button>
        </Tip>
        {hideButton}
      </div>
      {pending > 0 && (
        <div className="editor-side-review">
          <RiCheckDoubleLine aria-hidden="true" />
          <span>
            {pending === 1
              ? "1 agent edit batch to review"
              : `${pending} agent edit batches to review`}
          </span>
          <Button
            size="xs"
            variant="outline"
            disabled={locked || snapshot.saveState !== "saved"}
            onClick={() => run(() => session.markReviewed())}
          >
            Mark reviewed
          </Button>
        </div>
      )}
      <div
        className="editor-panel-content editor-side-scroll"
        role="region"
        aria-label="Change history"
        tabIndex={0}
      >
        {entries.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <RiHistoryLine aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>No changes yet</EmptyTitle>
              <EmptyDescription>
                Edits to this project, from you or an agent, appear here.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <>
            {groups.map((group) => (
              <div
                key={group.label}
                className="editor-side-group"
                role="group"
                aria-label={group.label}
              >
                <h3>{group.label}</h3>
                <ul className="editor-side-list">
                  {group.entries.map((entry) => {
                    const local = LOCAL_AUTHORS.includes(entry.author);
                    const date = entry.date ? new Date(entry.date) : null;
                    const current = entry.revision !== null && entry.revision === snapshot.revision;
                    return (
                      <li
                        key={entry.id}
                        className="editor-side-row editor-history-row"
                        data-kind={entry.kind}
                        data-current={current}
                        data-review={awaiting.has(entry.id)}
                        aria-current={current ? "step" : undefined}
                      >
                        <span className="editor-history-icon" data-agent={!local}>
                          {local ? (
                            <RiUser3Line aria-hidden="true" />
                          ) : (
                            <RiRobot2Line aria-hidden="true" />
                          )}
                        </span>
                        <span className="editor-history-body">
                          <span className="editor-side-text">{entry.label}</span>
                          <span className="editor-side-meta">
                            {entry.kind !== "edit" && (
                              <span className="editor-side-kind">
                                {entry.kind === "undo" ? "Undo" : "Redo"}
                              </span>
                            )}
                            {(entry.kind === "edit" || !local) && (
                              <span>{local ? "You" : entry.author}</span>
                            )}
                            {date && (
                              <Tip label={fullFormat.format(date)}>
                                <time dateTime={entry.date}>{relativeTime(date, now)}</time>
                              </Tip>
                            )}
                            {entry.revision !== null && <span>r{entry.revision}</span>}
                            {current && <span className="editor-side-kind">Current</span>}
                            {awaiting.has(entry.id) && (
                              <span className="editor-side-kind" data-tone="review">
                                To review
                              </span>
                            )}
                          </span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
            {!history.complete && (
              <p className="editor-side-note-line">
                Showing recent undo steps only; this project has no saved edit journal.
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
}
