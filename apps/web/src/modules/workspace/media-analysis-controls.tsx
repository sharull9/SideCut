import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { MediaItem } from "@sidecut/contracts/project";
import { Button } from "@sidecut/ui/components/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@sidecut/ui/components/field";
import { useEditorSession } from "./editor-session";

export function MediaAnalysisControls({ item }: { item: MediaItem }) {
  const { session, snapshot } = useEditorSession();
  const analysis = useSyncExternalStore(
    session.analysis.subscribe,
    session.analysis.getSnapshot,
    session.analysis.getSnapshot,
  );
  const [referenceID, setReferenceID] = useState("");
  const [error, setError] = useState<string | null>(null);
  const state = analysis[item.id];
  const available = snapshot.mediaAvailability[item.id]?.state === "available";
  const disabled = snapshot.readOnly || snapshot.busy || !available;
  useEffect(() => {
    if (available) void session.analysis.load(item.id).catch((cause) => setError(String(cause)));
  }, [available, item.id, session]);
  const run = (task: () => unknown) => {
    setError(null);
    Promise.resolve()
      .then(task)
      .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
  };
  return (
    <details className="editor-source-placement">
      <summary>Local analysis and preview</summary>
      <FieldGroup className="editor-trim-form">
        {item.kind === "video" && (
          <Field>
            <Button
              size="xs"
              variant="outline"
              disabled={disabled}
              onClick={() => run(() => session.analysis.generateProxy(item.id))}
            >
              Generate preview proxy
            </Button>
            <FieldDescription>
              640 px PNG frames preserve source timestamps and transparency. Up to 60 seconds, 3,600
              frames and 128 MiB. Audio and final export use the original.
            </FieldDescription>
            <FieldLabel htmlFor={`proxy-${item.id}`}>Use generated proxy in viewer</FieldLabel>
            <input
              id={`proxy-${item.id}`}
              type="checkbox"
              disabled={disabled || !state?.proxy}
              checked={state?.proxyEnabled ?? false}
              onChange={(event) =>
                run(() => session.analysis.useProxy(item.id, event.target.checked))
              }
            />
          </Field>
        )}
        {item.hasAudio && (
          <>
            <Field>
              <FieldLabel htmlFor={`sync-reference-${item.id}`}>Sound sync reference</FieldLabel>
              <select
                id={`sync-reference-${item.id}`}
                value={referenceID}
                disabled={disabled}
                onChange={(event) => setReferenceID(event.target.value)}
              >
                <option value="">Choose another recording</option>
                {snapshot.project.media
                  .filter((m) => m.id !== item.id && m.hasAudio)
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.path}
                    </option>
                  ))}
              </select>
              <Button
                size="xs"
                variant="outline"
                disabled={disabled || !referenceID}
                onClick={() => run(() => session.analysis.align(item.id, referenceID))}
              >
                Align take by sound
              </Button>
              <FieldDescription>
                Measures shared sound in recordings up to 60 seconds and saves take offsets. Review
                confidence, then place the take. Correct offsets under Role and take placement.
              </FieldDescription>
            </Field>
            <Field>
              <Button
                size="xs"
                variant="outline"
                disabled={disabled}
                onClick={() => run(() => session.analysis.transcribe(item.id))}
              >
                {state?.transcript
                  ? "Load cached local transcript"
                  : "Download model and transcribe locally"}
              </Button>
              <FieldDescription>
                English Whisper Tiny runs on this device. First use downloads the public model from
                Hugging Face and its CDN. Audio stays here. Up to ten minutes per source. Cancel in
                Background jobs.
              </FieldDescription>
              {state?.transcript && (
                <p>
                  {state.transcript.words.length} words · English · click words on the timeline to
                  seek.
                </p>
              )}
            </Field>
          </>
        )}
        {state?.status && <p role="status">{state.status}</p>}
        {(error || state?.error) && <FieldError role="alert">{error || state?.error}</FieldError>}
      </FieldGroup>
    </details>
  );
}

export function TakeIdentification({
  run,
  disabled,
}: {
  run: (action: () => unknown) => void;
  disabled: boolean;
}) {
  const { session } = useEditorSession();
  const picker = useRef<HTMLInputElement>(null);
  return (
    <div className="editor-take-actions">
      <Button
        size="xs"
        variant="ghost"
        disabled={disabled}
        onClick={() => run(() => session.analysis.identify())}
      >
        Identify takes
      </Button>
      <Button size="xs" variant="ghost" disabled={disabled} onClick={() => picker.current?.click()}>
        Import take timing
      </Button>
      <input
        ref={picker}
        type="file"
        accept=".take.json,application/json"
        className="sr-only"
        tabIndex={-1}
        aria-label="Take timing sidecar"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) run(() => session.analysis.identify(file));
        }}
      />
    </div>
  );
}
