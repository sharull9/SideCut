import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { RiChat3Line } from "@remixicon/react";
import { decodeProjectFile } from "@sidecut/contracts/project";
import { ReviewStore } from "@sidecut/platform-browser/review-store";
import { Button } from "@sidecut/ui/components/button";
import { Input } from "@sidecut/ui/components/input";
import { Field, FieldLabel, FieldDescription, FieldError } from "@sidecut/ui/components/field";
import { useEditorSession } from "./editor-session";
import { MediaSection } from "./media-section";
import { ReviewPlayer } from "./review-player";
import { reviewFeedbackCSV, reviewMarker } from "./review-feedback";
import { validReviewRange } from "./rendered-review-range";

type Version = Awaited<ReturnType<ReviewStore["listVersions"]>>[number];
type Thread = Awaited<ReturnType<ReviewStore["listThreads"]>>[number];

function time(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${(seconds % 60).toFixed(2).padStart(5, "0")}`;
}

export function RenderedReview() {
  const { session, snapshot } = useEditorSession();
  const exports = useSyncExternalStore(
    session.exports.subscribe,
    session.exports.getSnapshot,
    session.exports.getSnapshot,
  );
  const projectID = snapshot.project.id;
  const [versions, setVersions] = useState<Version[]>([]);
  const [versionID, setVersionID] = useState("");
  const [threads, setThreads] = useState<Thread[]>([]);
  const [url, setURL] = useState("");
  const [mediaType, setMediaType] = useState("");
  const [author, setAuthor] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [reply, setReply] = useState<Record<string, string>>({});
  const [duration, setDuration] = useState("0");
  const [currentTime, setCurrentTime] = useState(0);
  const [status, setStatus] = useState("open");
  const [authorFilter, setAuthorFilter] = useState("");
  const [textFilter, setTextFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const media = useRef<HTMLMediaElement | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const generation = useRef(0);
  const mutation = useRef(false);
  const disabled = busy || snapshot.busy || snapshot.readOnly;
  const version = versions.find((item) => item.id === versionID);

  useEffect(() => {
    let active = true;
    void ReviewStore.open()
      .then(async (store) => {
        const rows = await store.listVersions(projectID);
        if (active) {
          setVersions(rows);
          setVersionID((id) => (rows.some((row) => row.id === id) ? id : (rows[0]?.id ?? "")));
        }
      })
      .catch((e: unknown) => {
        if (active) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      active = false;
    };
  }, [projectID, refresh]);

  useEffect(() => {
    let active = true;
    let objectURL = "";
    generation.current++;
    setThreads([]);
    setURL("");
    setCurrentTime(0);
    if (versionID)
      void ReviewStore.open()
        .then(async (store) => {
          {
            const [blob, rows] = await Promise.all([
              store.artifact(versionID),
              store.listThreads(versionID),
            ]);
            if (!active) return;
            objectURL = URL.createObjectURL(blob);
            setMediaType(blob.type);
            setURL(objectURL);
            setThreads(rows);
          }
        })
        .catch((e: unknown) => {
          if (active) setError(e instanceof Error ? e.message : String(e));
        });
    return () => {
      active = false;
      if (objectURL) URL.revokeObjectURL(objectURL);
    };
  }, [projectID, versionID, refresh]);

  async function run(task: (store: ReviewStore) => Promise<void>) {
    if (mutation.current || disabled) return false;
    mutation.current = true;
    const token = generation.current;
    setBusy(true);
    setError("");
    try {
      const store = await ReviewStore.open();
      if (generation.current !== token || !mounted.current) return false;
      await task(store);
      if (generation.current === token && mounted.current) {
        setRefresh((value) => value + 1);
        return true;
      }
      return false;
    } catch (e) {
      if (generation.current === token && mounted.current)
        setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      mutation.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  const done = exports.filter((entry) => {
    const context = session.exports.getContext(entry.id);
    if (entry.status !== "done" || !session.exports.getOutput(entry.id) || !context) return false;
    try {
      return decodeProjectFile(JSON.parse(context.snapshotJSON)).project.id === projectID;
    } catch {
      return false;
    }
  });
  return (
    <MediaSection
      icon={<RiChat3Line aria-hidden="true" />}
      title="Review versions"
      count={versions.length}
    >
      <FieldDescription>
        Save a completed export to review it with time-based comments on this device.
      </FieldDescription>
      <Field>
        <FieldLabel htmlFor="review-author">Your name</FieldLabel>
        <Input
          id="review-author"
          value={author}
          onChange={(e) => setAuthor(e.target.value)}
          disabled={disabled}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="review-title">Version title</FieldLabel>
        <Input
          id="review-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={disabled}
        />
      </Field>
      {done.length === 0 && <p>Complete an export to save a review version.</p>}
      {done.map((entry) => (
        <div key={entry.id}>
          <span>
            {entry.name}
            {entry.preset ? ` · ${entry.preset}` : ""}
          </span>{" "}
          <Button
            size="sm"
            variant="outline"
            disabled={disabled || !author.trim()}
            onClick={() =>
              void run(async (store) => {
                const blob = session.exports.getOutput(entry.id),
                  context = session.exports.getContext(entry.id);
                if (!blob || !context)
                  throw new Error(
                    "This export is no longer available. Export again to save a version.",
                  );
                await store.publish(
                  { ...context, createdBy: author.trim(), title: title.trim() || entry.name },
                  blob,
                  entry.name,
                );
              })
            }
          >
            Save review version
          </Button>
        </div>
      ))}
      {versions.length > 0 && (
        <Field>
          <FieldLabel htmlFor="review-version">Version</FieldLabel>
          <select
            id="review-version"
            value={versionID}
            onChange={(e) => setVersionID(e.target.value)}
          >
            {versions.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
        </Field>
      )}
      {version && url && (
        <ReviewPlayer
          url={url}
          mediaType={mediaType}
          version={version}
          mediaRef={media}
          onTimeUpdate={setCurrentTime}
          onError={setError}
        />
      )}
      {version && (
        <>
          <p>
            At {time(currentTime)} of {time(version.source.durationSeconds)}
          </p>
          <Field>
            <FieldLabel htmlFor="review-duration">
              Range duration in seconds (0 for a point)
            </FieldLabel>
            <Input
              id="review-duration"
              type="number"
              min="0"
              step="0.01"
              value={duration}
              disabled={disabled}
              onChange={(e) => setDuration(e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="review-body">Comment</FieldLabel>
            <Input
              id="review-body"
              value={body}
              disabled={disabled}
              onChange={(e) => setBody(e.target.value)}
            />
          </Field>
          <Button
            size="sm"
            disabled={disabled || !author.trim() || !body.trim() || !url}
            onClick={() =>
              void run(async (store) => {
                const seconds = Number(duration);
                if (!validReviewRange(currentTime, seconds, version.source.durationSeconds))
                  throw new Error("Choose a range within this version.");
                await store.createThread({
                  versionID,
                  versionStartSeconds: currentTime,
                  durationSeconds: seconds,
                  author: author.trim(),
                  body: body.trim(),
                });
              }).then((saved) => {
                if (saved) setBody("");
              })
            }
          >
            Add comment at current time
          </Button>
          <Field>
            <FieldLabel htmlFor="review-status-filter">Feedback status</FieldLabel>
            <select
              id="review-status-filter"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="open">Open</option>
              <option value="resolved">Resolved</option>
              <option value="all">All</option>
            </select>
          </Field>
          <Field>
            <FieldLabel htmlFor="review-author-filter">Filter by author</FieldLabel>
            <Input
              id="review-author-filter"
              value={authorFilter}
              onChange={(e) => setAuthorFilter(e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="review-text-filter">Filter by text</FieldLabel>
            <Input
              id="review-text-filter"
              value={textFilter}
              onChange={(e) => setTextFilter(e.target.value)}
            />
          </Field>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              const downloadURL = URL.createObjectURL(
                new Blob([reviewFeedbackCSV(version, threads)], { type: "text/csv;charset=utf-8" }),
              );
              const link = document.createElement("a");
              link.href = downloadURL;
              link.download = "review-feedback.csv";
              link.click();
              setTimeout(() => URL.revokeObjectURL(downloadURL), 0);
            }}
          >
            Export feedback CSV
          </Button>
          <p>{threads.filter((thread) => !thread.resolvedAt).length} open</p>
          <ul className="editor-asset-results">
            {threads
              .filter(
                (thread) =>
                  (status === "all" || (status === "resolved") === Boolean(thread.resolvedAt)) &&
                  (!authorFilter.trim() ||
                    [thread.author, ...thread.replies.map((item) => item.author)].some((value) =>
                      value.toLowerCase().includes(authorFilter.trim().toLowerCase()),
                    )) &&
                  (!textFilter.trim() ||
                    [thread.body, ...thread.replies.map((item) => item.body)].some((value) =>
                      value.toLowerCase().includes(textFilter.trim().toLowerCase()),
                    )),
              )
              .map((thread) => (
                <li key={thread.id}>
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => {
                      if (media.current)
                        media.current.currentTime = thread.anchor.versionStartSeconds;
                    }}
                  >
                    {time(thread.anchor.versionStartSeconds)}
                    {thread.anchor.durationSeconds > 0
                      ? ` – ${time(thread.anchor.versionStartSeconds + thread.anchor.durationSeconds)}`
                      : ""}
                  </Button>
                  <strong>{thread.author}</strong>
                  <p>{thread.body}</p>
                  {thread.replies.map((item) => (
                    <p key={item.id}>
                      <strong>{item.author}</strong>: {item.body}
                    </p>
                  ))}
                  {thread.resolvedAt && <small>Resolved by {thread.resolvedBy}</small>}
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={disabled}
                    onClick={() => {
                      try {
                        const current = session.getSnapshot();
                        session.apply(
                          reviewMarker(version, thread, {
                            project: current.project,
                            revision: current.revision,
                          }),
                        );
                        setError("");
                      } catch (e) {
                        setError(e instanceof Error ? e.message : String(e));
                      }
                    }}
                  >
                    Create timeline marker
                  </Button>
                  <Field>
                    <FieldLabel htmlFor={`review-reply-${thread.id}`}>Reply</FieldLabel>
                    <Input
                      id={`review-reply-${thread.id}`}
                      value={reply[thread.id] ?? ""}
                      disabled={disabled}
                      onChange={(e) => setReply((old) => ({ ...old, [thread.id]: e.target.value }))}
                    />
                  </Field>
                  <Button
                    size="xs"
                    disabled={disabled || !author.trim() || !reply[thread.id]?.trim()}
                    onClick={() =>
                      void run(async (store) => {
                        await store.reply(thread.id, thread.revision, {
                          author: author.trim(),
                          body: (reply[thread.id] ?? "").trim(),
                        });
                      }).then((saved) => {
                        if (saved) setReply((old) => ({ ...old, [thread.id]: "" }));
                      })
                    }
                  >
                    Reply
                  </Button>{" "}
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={disabled || !author.trim()}
                    onClick={() =>
                      void run(async (store) => {
                        await store.resolve(thread.id, thread.revision, {
                          author: author.trim(),
                          resolved: !thread.resolvedAt,
                        });
                      })
                    }
                  >
                    {thread.resolvedAt ? "Reopen" : "Resolve"}
                  </Button>
                </li>
              ))}
          </ul>
        </>
      )}
      {error && (
        <>
          <FieldError>{error}</FieldError>
          <Button
            size="xs"
            variant="outline"
            onClick={() => {
              setError("");
              setRefresh((value) => value + 1);
            }}
          >
            Retry
          </Button>
        </>
      )}
    </MediaSection>
  );
}
