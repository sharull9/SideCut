import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { RiFolderVideoLine } from "@remixicon/react";
import type { RecordingEntry } from "@sidecut/contracts/recordings";
import {
  savedRecordings,
  savedRecordingFile,
  saveRecordingToDirectory,
  withSavedRecording,
} from "@sidecut/platform-browser/recording-storage";
import { Button } from "@sidecut/ui/components/button";
import { MediaSection } from "./media-section";
import { useEditorSession } from "./editor-session";

declare global {
  interface Window {
    showDirectoryPicker?: (options?: { mode: "readwrite" }) => Promise<FileSystemDirectoryHandle>;
  }
}

export function SavedRecordings() {
  const { session, snapshot } = useEditorSession();
  const capture = useSyncExternalStore(
    session.recording.subscribe,
    session.recording.getSnapshot,
    session.recording.getSnapshot,
  );
  const [entries, setEntries] = useState<RecordingEntry[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [directory, setDirectory] = useState<FileSystemDirectoryHandle | null>(null);
  const [nativeDirectory, setNativeDirectory] = useState(false);
  const [version, setVersion] = useState(0);
  const pending = useRef(false);
  const unavailable = snapshot.readOnly || snapshot.busy;

  useEffect(() => {
    let current = true;
    if (snapshot.saveState === "loading") return;
    void savedRecordings()
      .then((rows) => {
        if (current) setEntries(rows);
      })
      .catch((error: unknown) => {
        if (current)
          setMessage(error instanceof Error ? error.message : "Could not read saved recordings.");
      });
    return () => {
      current = false;
    };
  }, [capture.status, snapshot.saveState, version]);

  async function action(task: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setMessage(null);
    try {
      await task();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Recording operation failed. Your saved chunks are retained.",
      );
    } finally {
      pending.current = false;
      setBusy(false);
      setVersion((value) => value + 1);
    }
  }
  async function chooseDirectory() {
    if (session.native?.recordingDirectory)
      setNativeDirectory(await session.native.recordingDirectory());
    else if (window.showDirectoryPicker)
      setDirectory(await window.showDirectoryPicker({ mode: "readwrite" }));
    else
      throw new Error(
        "Folder output is unavailable in this browser. Use Download for recordings up to 128 MiB, or the desktop app for larger files.",
      );
  }
  async function importEntry(entry: RecordingEntry) {
    if (session.getSnapshot().project.id !== entry.projectID)
      throw new Error("Open the original project before importing this recording.");
    await withSavedRecording(entry.id, async (store) => {
      const file = await savedRecordingFile(store, entry.id);
      if (session.getSnapshot().project.id !== entry.projectID)
        throw new Error("The project changed while the recording was loading.");
      if (session.getSnapshot().saveState === "error") await session.retrySave();
      if (session.getSnapshot().project.id !== entry.projectID)
        throw new Error("The project changed while the recording was loading.");
      await session.importFiles([file]);
      await store.remove(entry.id);
    });
  }
  async function downloadEntry(entry: RecordingEntry) {
    await withSavedRecording(entry.id, async (store) => {
      const file = await savedRecordingFile(store, entry.id);
      const url = URL.createObjectURL(file),
        link = document.createElement("a");
      link.href = url;
      link.download = file.name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    });
  }
  async function saveEntry(entry: RecordingEntry) {
    let name: string;
    const nativeExport = session.native?.recordingExport;
    if (nativeExport && nativeDirectory) {
      name = await withSavedRecording(entry.id, async (store) => {
        if (entry.status === "capturing") await store.seal(entry.id, "interrupted");
        return (await nativeExport(entry.id)).name;
      });
    } else if (directory) name = await saveRecordingToDirectory(entry.id, directory);
    else throw new Error("Choose an output folder first.");
    setMessage(`Saved ${name} to the selected folder. The local recording is retained.`);
  }
  return (
    <MediaSection
      icon={<RiFolderVideoLine aria-hidden="true" />}
      title="Saved recordings"
      count={entries.length}
    >
      <p>
        Completed and interrupted captures stay on this device until removed. Partial files need
        media validation before editing.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => {
            void action(chooseDirectory);
          }}
        >
          Choose recording output folder
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => setVersion((value) => value + 1)}
        >
          Refresh saved recordings
        </Button>
      </div>
      {(directory || nativeDirectory) && (
        <p role="status">Output folder selected for this session.</p>
      )}
      {message && <p role="status">{message}</p>}
      {!entries.length && <p>No saved recordings.</p>}
      <ul>
        {entries.map((entry) => (
          <li key={entry.id} data-testid="saved-recording" className="flex flex-col gap-2 py-2">
            <span>
              {entry.createdAt} · {(entry.bytes / 1024 / 1024).toFixed(1)} MiB ·{" "}
              {entry.status === "ready" ? "Ready" : "Interrupted"}
            </span>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={
                  busy ||
                  unavailable ||
                  entry.status !== "ready" ||
                  entry.projectID !== snapshot.project.id ||
                  entry.bytes > 128 * 1024 * 1024
                }
                onClick={() => {
                  void action(() => importEntry(entry));
                }}
              >
                Import saved recording
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy || entry.status !== "ready" || entry.bytes > 128 * 1024 * 1024}
                onClick={() => {
                  void action(() => downloadEntry(entry));
                }}
              >
                Download saved recording
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy || !entry.bytes || (!directory && !nativeDirectory)}
                onClick={() => {
                  void action(() => saveEntry(entry));
                }}
              >
                Save recording to folder
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy || unavailable}
                onClick={() => {
                  void action(() =>
                    withSavedRecording(entry.id, async (store) => {
                      if (entry.status === "capturing") await store.seal(entry.id, "interrupted");
                      await store.remove(entry.id);
                    }),
                  );
                }}
              >
                Remove saved recording
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </MediaSection>
  );
}
