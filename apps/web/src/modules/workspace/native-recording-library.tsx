import { useCallback, useEffect, useRef, useState } from "react";
import { RiFolderVideoLine } from "@remixicon/react";
import type { NativeRecording } from "@sidecut/contracts/native-recording";
import { Button } from "@sidecut/ui/components/button";
import { useEditorSession } from "./editor-session";
import { nativeBridge } from "./host-coordinator";
import { MediaSection } from "./media-section";

const IMPORT_LIMIT = 100 * 1024 ** 3;

export function NativeRecordingLibrary() {
  const bridge = nativeBridge();
  const [open, setOpen] = useState(false);
  if (!bridge?.nativeRecordingList) return null;
  return (
    <div
      onToggle={(event) => {
        if (
          event.target === event.currentTarget.firstElementChild &&
          event.target instanceof HTMLDetailsElement
        )
          setOpen(event.target.open);
      }}
    >
      <MediaSection
        icon={<RiFolderVideoLine aria-hidden="true" />}
        title="Native recording library"
      >
        {open && <LibraryContents />}
      </MediaSection>
    </div>
  );
}

function LibraryContents() {
  const { session, snapshot } = useEditorSession();
  const bridge = nativeBridge();
  const [recordings, setRecordings] = useState<NativeRecording[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(false);
  const generation = useRef(0);
  const fetching = useRef(false);
  const actionPending = useRef(false);

  const refresh = useCallback(async () => {
    if (fetching.current || !bridge?.nativeRecordingList) return;
    fetching.current = true;
    const requestGeneration = generation.current;
    try {
      const items = await bridge.nativeRecordingList();
      if (alive.current && requestGeneration === generation.current) {
        setRecordings(items);
        setLoading(false);
      }
    } catch (cause) {
      if (alive.current && requestGeneration === generation.current) {
        setLoading(false);
        setError(cause instanceof Error ? cause.message : "Could not load native recordings.");
      }
    } finally {
      fetching.current = false;
    }
  }, [bridge]);

  useEffect(() => {
    alive.current = true;
    const effectGeneration = generation.current;
    let current = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      await refresh();
      if (current) timer = setTimeout(poll, 3000);
    };
    void poll();
    return () => {
      current = false;
      alive.current = false;
      generation.current = effectGeneration + 1;
      clearTimeout(timer);
    };
  }, [refresh]);

  async function action(task: () => Promise<void>) {
    if (actionPending.current) return;
    actionPending.current = true;
    setPending(true);
    setError(null);
    try {
      await task();
      await refresh();
    } catch (cause) {
      if (alive.current)
        setError(cause instanceof Error ? cause.message : "Recording operation failed.");
    } finally {
      actionPending.current = false;
      if (alive.current) setPending(false);
    }
  }

  const locked = recordings.some(
    (item) => item.status === "recording" || item.status === "stopping",
  );
  const blocked =
    snapshot.readOnly || snapshot.busy || snapshot.saveState === "loading" || pending || loading;
  return (
    <>
      <p>Native recordings stay on this device after import. Imports are limited to 100 GiB.</p>
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() => {
          setError(null);
          void refresh();
        }}
      >
        Refresh
      </Button>
      {error && <p role="alert">{error}</p>}
      {loading ? (
        <p>Loading recordings…</p>
      ) : recordings.length === 0 ? (
        <p>No native recordings.</p>
      ) : null}
      {locked && <p>Library actions are unavailable while a recording is active or finishing.</p>}
      <ul>
        {recordings.map((item) => (
          <li key={item.id} className="flex flex-col gap-2 py-2">
            <RecordingPoster item={item} locked={locked} />
            <span>
              {item.source} · {item.status} · {Math.floor(item.elapsedSeconds)} seconds ·{" "}
              {(item.bytes / 1024 / 1024).toFixed(1)} MiB
            </span>
            <span>
              Created {item.createdAt} ·{" "}
              {item.tracks.length
                ? item.tracks
                    .map(
                      (track) =>
                        `${track.kind}: starts ${track.startSeconds.toFixed(2)}s, duration ${track.durationSeconds.toFixed(2)}s`,
                    )
                    .join(" · ")
                : "Track timing unavailable"}
            </span>
            {item.error && <p>{item.error}</p>}
            {item.bytes > IMPORT_LIMIT && <p>This recording exceeds the 100 GiB import limit.</p>}
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={blocked || locked || item.status !== "ready" || item.bytes > IMPORT_LIMIT}
                onClick={() => void action(() => session.importNativeRecording(item.id, "media"))}
              >
                Add to project
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={blocked || locked || item.status !== "ready" || item.bytes > IMPORT_LIMIT}
                onClick={() =>
                  void action(() => session.importNativeRecording(item.id, "new-project"))
                }
              >
                Edit in new project
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={blocked || locked || !bridge?.nativeRecordingReveal}
                onClick={() => void action(() => bridge!.nativeRecordingReveal!(item.id))}
              >
                Reveal
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={blocked || locked || !bridge?.nativeRecordingDelete}
                onClick={() => void action(() => bridge!.nativeRecordingDelete!(item.id))}
              >
                Delete recording
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

function RecordingPoster({ item, locked }: { item: NativeRecording; locked: boolean }) {
  const [poster, setPoster] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const requested = useRef(false);
  const target = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const element = target.current;
    if (!element) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const bridge = nativeBridge();
    if (
      !visible ||
      locked ||
      item.status !== "ready" ||
      requested.current ||
      !bridge?.nativeRecordingPoster
    )
      return;
    let current = true;
    let settled = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    requested.current = true;
    void bridge
      .nativeRecordingPoster(item.id)
      .then((url) => {
        settled = true;
        if (current) setPoster(url);
      })
      .catch((error: unknown) => {
        if (!current) return;
        requested.current = false;
        if (error instanceof Error && error.message.includes("operation is already active"))
          retry = setTimeout(() => setAttempt((value) => value + 1), 1000);
      });
    return () => {
      current = false;
      clearTimeout(retry);
      if (!settled) requested.current = false;
    };
  }, [item.id, item.status, locked, visible, attempt]);
  return (
    <div ref={target}>
      {poster && (
        <img
          src={poster}
          alt={`Poster for ${item.source} recording`}
          loading="lazy"
          className="max-w-full"
        />
      )}
    </div>
  );
}
