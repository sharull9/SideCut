import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { RiRecordCircleLine } from "@remixicon/react";
import { recordingSupport, type RecordingSource } from "@sidecut/platform-browser/recording";
import { Button, buttonVariants } from "@sidecut/ui/components/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@sidecut/ui/components/field";
import { MediaSection } from "./media-section";
import { useEditorSession } from "./editor-session";

export function RecordingControls() {
  const { session, snapshot } = useEditorSession();
  const recording = session.recording;
  const state = useSyncExternalStore(
    recording.subscribe,
    recording.getSnapshot,
    recording.getSnapshot,
  );
  const [source, setSource] = useState<RecordingSource>(
    () => session.recordingRequest?.source ?? "screen",
  );
  const [microphone, setMicrophone] = useState(() => session.recordingRequest?.microphone ?? false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [cameraID, setCameraID] = useState(() => session.recordingRequest?.cameraID ?? "");
  const [microphoneID, setMicrophoneID] = useState(
    () => session.recordingRequest?.microphoneID ?? "",
  );
  const [error, setError] = useState<string | null>(null);
  const [download, setDownload] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [importing, setImporting] = useState(false);
  const importPending = useRef(false);
  const support = recordingSupport();
  const active = ["requesting", "recording", "stopping"].includes(state.status);
  const blocked = snapshot.readOnly || snapshot.busy || snapshot.saveState === "loading";
  const sameProject = session.recordingProjectID === snapshot.project.id;
  const startedAt = state.status === "recording" ? state.startedAt : null;
  const file = state.status === "ready" ? state.file : null;
  useEffect(() => {
    let alive = true;
    let latest = 0;
    const media = navigator.mediaDevices;
    if (!media?.enumerateDevices) return;
    const refresh = () => {
      const request = ++latest;
      void media
        .enumerateDevices()
        .then((next) => {
          if (alive && request === latest)
            setDevices(
              next.filter((device) => device.kind === "videoinput" || device.kind === "audioinput"),
            );
        })
        .catch(() => {});
    };
    refresh();
    media.addEventListener("devicechange", refresh);
    return () => {
      alive = false;
      media.removeEventListener("devicechange", refresh);
    };
  }, [state.status]);

  useEffect(() => {
    if (startedAt === null) return;
    const update = () => setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [startedAt]);

  useEffect(() => {
    if (!file) {
      setDownload(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setDownload(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  async function start() {
    setError(null);
    setElapsed(0);
    try {
      await session.startRecording({
        source,
        microphone,
        cameraID: cameraID || undefined,
        microphoneID: microphoneID || undefined,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start recording.");
    }
  }
  async function discard() {
    setError(null);
    try {
      await recording.discard();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not remove the local recording.");
    }
  }
  async function addToProject() {
    if (state.status !== "ready" || importPending.current) return;
    const current = session.getSnapshot();
    if (current.project.id !== session.recordingProjectID || current.readOnly || current.busy) {
      setError("Return to the original writable project to add this recording, or download it.");
      return;
    }
    importPending.current = true;
    setImporting(true);
    setError(null);
    try {
      await session.importRecording();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Import failed. Download the recording or retry.",
      );
    } finally {
      importPending.current = false;
      setImporting(false);
    }
  }

  return (
    <MediaSection icon={<RiRecordCircleLine aria-hidden="true" />} title="Record">
      <FieldGroup className="gap-2">
        <Field>
          <FieldLabel htmlFor="recording-source">Source</FieldLabel>
          <select
            id="recording-source"
            value={source}
            disabled={active || state.status === "ready" || importing}
            onChange={(event) => {
              const next = event.target.value;
              if (next === "screen" || next === "camera" || next === "microphone") setSource(next);
            }}
          >
            <option value="screen">Screen or window</option>
            <option value="camera">Camera</option>
            <option value="microphone">Microphone</option>
          </select>
          <FieldDescription>
            Up to 5 minutes or 128 MiB. Screen recordings exclude system audio. Files stay on this
            device.
          </FieldDescription>
        </Field>
        {(["videoinput", "audioinput"] as const).map((kind) => {
          if (kind === "videoinput" ? source !== "camera" : source !== "microphone" && !microphone)
            return null;
          const id = kind === "videoinput" ? cameraID : microphoneID;
          const label = kind === "videoinput" ? "Camera" : "Microphone";
          const available = devices.filter((device) => device.kind === kind);
          return (
            <Field key={kind}>
              <FieldLabel htmlFor={`recording-${kind}`}>{label}</FieldLabel>
              <select
                id={`recording-${kind}`}
                value={id}
                disabled={active || state.status === "ready" || importing}
                onChange={(event) =>
                  (kind === "videoinput" ? setCameraID : setMicrophoneID)(event.target.value)
                }
              >
                <option value="">System default</option>
                {id && !available.some((device) => device.deviceId === id) && (
                  <option value={id}>Disconnected device — choose another</option>
                )}
                {available
                  .filter((device) => device.deviceId)
                  .map((device, index) => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {device.label || `${label} ${index + 1}`}
                    </option>
                  ))}
              </select>
            </Field>
          );
        })}
        {source !== "microphone" && (
          <Field orientation="horizontal">
            <input
              id="recording-microphone"
              type="checkbox"
              checked={microphone}
              disabled={active || state.status === "ready" || importing}
              onChange={(event) => setMicrophone(event.target.checked)}
            />
            <FieldLabel htmlFor="recording-microphone">Include microphone</FieldLabel>
          </Field>
        )}
        {!support[source] ? (
          <p>
            This source needs a supported browser over HTTPS or localhost, with local storage and
            WebM recording.
          </p>
        ) : null}
        <p role="status" aria-live="polite" className="empty:hidden">
          {state.status === "requesting" &&
            "Choose a source and allow access. Recording starts when the source is ready."}
          {state.status === "recording" &&
            `Recording · ${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}. Stops automatically at 5 minutes.`}
          {state.status === "stopping" && "Finishing local recording…"}
          {state.status === "ready" &&
            (sameProject
              ? "Recording ready. Add it to Project media, then place it on the timeline."
              : "Recording belongs to the previous project. Download it or return to that project.")}
        </p>
        {(error || state.status === "error") && (
          <p role="alert">{error ?? (state.status === "error" ? state.message : "")}</p>
        )}
        <div className="flex flex-wrap gap-2">
          {(state.status === "idle" || state.status === "error") && (
            <Button
              size="sm"
              disabled={blocked || !support[source]}
              onClick={() => {
                void start();
              }}
            >
              Start recording
            </Button>
          )}
          {state.status === "recording" && (
            <Button size="sm" onClick={() => recording.stop()}>
              Stop recording
            </Button>
          )}
          {state.status === "ready" && (
            <>
              <Button
                size="sm"
                disabled={blocked || !sameProject || importing}
                onClick={() => {
                  void addToProject();
                }}
              >
                {importing ? "Adding…" : "Add recording to project"}
              </Button>
              {download && (
                <a
                  className={buttonVariants({ size: "sm", variant: "outline" })}
                  href={download}
                  download={state.file.name}
                >
                  Download recording
                </a>
              )}
            </>
          )}
          {(active || state.status === "ready") && (
            <Button
              size="sm"
              variant="outline"
              disabled={importing}
              onClick={() => {
                void discard();
              }}
            >
              {state.status === "ready" ? "Discard recording" : "Cancel recording"}
            </Button>
          )}
        </div>
      </FieldGroup>
    </MediaSection>
  );
}
