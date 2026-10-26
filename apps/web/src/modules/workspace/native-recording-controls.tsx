import { useEffect, useState } from "react";
import { RiRecordCircleLine } from "@remixicon/react";
import type {
  NativeCaptureDevice,
  NativeRecording,
  NativeRecordingRequest,
} from "@sidecut/contracts/native-recording";
import { Button } from "@sidecut/ui/components/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@sidecut/ui/components/field";
import { useEditorSession } from "./editor-session";
import { nativeBridge } from "./host-coordinator";
import { MediaSection } from "./media-section";

export function NativeRecordingControls() {
  const { snapshot } = useEditorSession();
  const bridge = nativeBridge();
  const [source, setSource] = useState<NativeRecordingRequest["source"]>("screen");
  const [encoder, setEncoder] = useState<NativeRecordingRequest["encoder"]>("auto");
  const [deviceID, setDeviceID] = useState("");
  const [microphoneID, setMicrophoneID] = useState("");
  const [devices, setDevices] = useState<NativeCaptureDevice[]>([]);
  const [recordings, setRecordings] = useState<NativeRecording[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open || !bridge?.nativeRecordingList || !bridge.nativeRecordingDevices) return;
    let alive = true;
    const refresh = () =>
      void bridge
        .nativeRecordingList?.()
        .then((items) => {
          if (alive) setRecordings(items);
        })
        .catch((cause: unknown) => {
          if (alive)
            setError(cause instanceof Error ? cause.message : "Could not load recordings.");
        });
    void bridge
      .nativeRecordingDevices()
      .then((items) => {
        if (alive) setDevices(items);
      })
      .catch((cause: unknown) => {
        if (alive) setError(cause instanceof Error ? cause.message : "Could not list devices.");
      });
    refresh();
    const timer = setInterval(refresh, 3000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [open, bridge]);
  if (!bridge?.nativeRecordingStart || !bridge.nativeRecordingStop || !bridge.nativeRecordingRetry)
    return null;
  const active = recordings.find(
    (item) => item.status === "recording" || item.status === "stopping",
  );
  const blocked = snapshot.readOnly || snapshot.busy || snapshot.saveState === "loading" || pending;
  const run = async (action: () => Promise<NativeRecording>) => {
    setPending(true);
    setError(null);
    try {
      await action();
      setRecordings(await bridge.nativeRecordingList!());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Native recording failed.");
    } finally {
      setPending(false);
    }
  };
  const options = (kind: NativeCaptureDevice["kind"]) =>
    devices
      .filter((device) => device.kind === kind)
      .map((device) => (
        <option key={device.id} value={device.id}>
          {device.name}
        </option>
      ));
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
      <MediaSection icon={<RiRecordCircleLine aria-hidden="true" />} title="Native recording">
        <FieldGroup className="gap-2">
          <Field>
            <FieldLabel htmlFor="native-source">Source</FieldLabel>
            <select
              id="native-source"
              value={source}
              disabled={blocked || !!active}
              onChange={(event) => {
                const value = event.target.value;
                if (value === "screen" || value === "camera" || value === "microphone") {
                  setSource(value);
                  setDeviceID("");
                  setMicrophoneID("");
                }
              }}
            >
              <option value="screen">Entire desktop</option>
              <option value="camera">Camera</option>
              <option value="microphone">Microphone</option>
            </select>
            <FieldDescription>
              Native recordings stay on local disk. Screen capture records the entire desktop;
              system audio is excluded. Import and library controls are coming later.
            </FieldDescription>
          </Field>
          {source !== "screen" && (
            <Field>
              <FieldLabel htmlFor="native-device">
                {source === "camera" ? "Camera" : "Microphone"}
              </FieldLabel>
              <select
                id="native-device"
                value={deviceID}
                disabled={blocked || !!active}
                onChange={(event) => setDeviceID(event.target.value)}
              >
                <option value="">Select a device</option>
                {options(source)}
              </select>
            </Field>
          )}
          {source !== "microphone" && (
            <Field>
              <FieldLabel htmlFor="native-mic">Microphone (optional)</FieldLabel>
              <select
                id="native-mic"
                value={microphoneID}
                disabled={blocked || !!active}
                onChange={(event) => setMicrophoneID(event.target.value)}
              >
                <option value="">None</option>
                {options("microphone")}
              </select>
            </Field>
          )}
          <Field>
            <FieldLabel htmlFor="native-encoder">Encoder profile</FieldLabel>
            <select
              id="native-encoder"
              value={encoder}
              disabled={blocked || !!active}
              onChange={(event) => {
                if (event.target.value === "auto" || event.target.value === "software")
                  setEncoder(event.target.value);
              }}
            >
              <option value="auto">Automatic</option>
              <option value="software">Software</option>
            </select>
          </Field>
          {error && <p role="alert">{error}</p>}
          {active ? (
            <>
              <p role="status">
                {active.status === "stopping"
                  ? "Finishing recording…"
                  : `Recording · ${Math.floor(active.elapsedSeconds)} seconds`}
              </p>
              <Button
                size="sm"
                disabled={pending || active.status !== "recording"}
                onClick={() => void run(() => bridge.nativeRecordingStop!())}
              >
                Stop recording
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              disabled={blocked || (source !== "screen" && !deviceID)}
              onClick={() =>
                void run(() =>
                  bridge.nativeRecordingStart!({
                    projectID: snapshot.project.id,
                    source,
                    encoder,
                    ...(deviceID && source !== "screen" ? { deviceID } : {}),
                    ...(microphoneID && source !== "microphone" ? { microphoneID } : {}),
                  }),
                )
              }
            >
              Start recording
            </Button>
          )}
          {recordings
            .filter(
              (item) =>
                item.projectID === snapshot.project.id &&
                item.status !== "recording" &&
                item.status !== "stopping",
            )
            .map((item) => (
              <div key={item.id}>
                <p>
                  {item.source} · {item.status} · {Math.floor(item.elapsedSeconds)} seconds
                  {item.error ? ` · ${item.error}` : ""}
                </p>
                {(item.status === "error" || item.status === "interrupted") && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={blocked || !!active}
                    onClick={() => void run(() => bridge.nativeRecordingRetry!(item.id))}
                  >
                    Retry finalization
                  </Button>
                )}
              </div>
            ))}
        </FieldGroup>
      </MediaSection>
    </div>
  );
}
