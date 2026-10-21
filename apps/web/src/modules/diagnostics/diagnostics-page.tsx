import { useEffect, useState } from "react";
import { Button } from "@sidecut/ui/components/button";
import { runContractProbe } from "./contract-probe";
import { runMediaProbe } from "./media-probe";
import type { MediaProbeResult } from "./media-probe";
import { Link } from "@tanstack/react-router";
import { useEditorSession } from "../workspace/editor-session";
import { runSessionProbe } from "./session-probe";

export function DiagnosticsPage() {
  const { session, snapshot } = useEditorSession();
  const [sessionResult, setSessionResult] = useState<ReturnType<typeof runSessionProbe> | null>(
    null,
  );
  const [contracts, setContracts] = useState<ReturnType<typeof runContractProbe> | null>(null);
  const [media, setMedia] = useState<MediaProbeResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [download, setDownload] = useState<string | null>(null);

  useEffect(
    () => () => {
      if (download) URL.revokeObjectURL(download);
    },
    [download],
  );

  async function checkMedia() {
    setRunning(true);
    setError(null);
    setMedia(null);
    setDownload(null);
    try {
      const { result, blob } = await runMediaProbe();
      setMedia(result);
      if (blob) setDownload(URL.createObjectURL(blob));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRunning(false);
    }
  }

  function checkContracts() {
    setError(null);
    try {
      setContracts(runContractProbe());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  return (
    <main className="mx-auto flex min-h-svh max-w-4xl flex-col gap-8 px-6 py-12">
      <header className="space-y-3">
        <Link to="/" className="text-sm text-muted-foreground underline">
          Back to editor
        </Link>
        <h1 className="font-heading text-3xl font-semibold">Compatibility checks</h1>
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
          Verify the project, command session, and media capabilities on this browser. Media checks
          create a short synthetic picture and tone locally. No camera, microphone, or upload is
          used.
        </p>
      </header>
      <section aria-labelledby="session-heading" className="flex flex-col gap-4 border-t pt-6">
        <h2 id="session-heading" className="text-lg font-medium">
          Validation and command session
        </h2>
        <p className="text-sm text-muted-foreground">
          Check atomic batches, revision conflicts, retries, and undo/redo. The sample edit below
          changes the current editor session without adding media.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button
            onClick={() => {
              setError(null);
              try {
                setSessionResult(runSessionProbe());
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : String(cause));
              }
            }}
          >
            Run session checks
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setError(null);
              try {
                session.apply({
                  label: "Prepare sample sequence",
                  expectedRevision: snapshot.revision,
                  idempotencyKey: crypto.randomUUID(),
                  commands: [
                    { updateProject: { patch: { name: "Compatibility study" } } },
                    { updateSettings: { patch: { width: 1280, height: 720 } } },
                  ],
                });
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : String(cause));
              }
            }}
          >
            Apply sample batch to editor
          </Button>
          <Button variant="outline" disabled={!snapshot.undoLabel} onClick={() => session.undo()}>
            Undo sample edit
          </Button>
          <Button variant="outline" disabled={!snapshot.redoLabel} onClick={() => session.redo()}>
            Redo sample edit
          </Button>
        </div>
        <p role="status" data-testid="live-session" className="text-sm text-muted-foreground">
          {snapshot.project.name}, {snapshot.project.settings.width} ×{" "}
          {snapshot.project.settings.height}, revision {snapshot.revision}
        </p>
        {sessionResult && (
          <pre
            data-testid="session-result"
            className="overflow-auto rounded-md bg-muted p-4 text-xs leading-6"
          >
            {JSON.stringify(sessionResult, null, 2)}
          </pre>
        )}
      </section>
      <section aria-labelledby="contracts-heading" className="space-y-4 border-t pt-6">
        <h2 id="contracts-heading" className="text-lg font-medium">
          Project format and timing
        </h2>
        <p className="text-sm text-muted-foreground">
          Check reference defaults, all five clip variants, exact sample timing, file round trips,
          and future-version rejection.
        </p>
        <Button onClick={checkContracts}>Run project checks</Button>
        {contracts && (
          <div role="status">
            <p className="mb-3 text-sm text-primary">Project checks passed</p>
            <pre
              data-testid="contract-result"
              className="overflow-auto rounded-md bg-muted p-4 text-xs leading-6"
            >
              {JSON.stringify(contracts, null, 2)}
            </pre>
          </div>
        )}
      </section>
      <section aria-labelledby="media-heading" className="space-y-4 border-t pt-6">
        <h2 id="media-heading" className="text-lg font-medium">
          Browser media feasibility
        </h2>
        <p className="text-sm text-muted-foreground">
          Test VP8, VP9, and H.264 frames, then record and decode a tiny video with audible audio.
          This probe does not establish full editor export support.
        </p>
        <Button onClick={() => void checkMedia()} disabled={running}>
          {running ? "Checking media…" : "Run media checks"}
        </Button>
        <p role="status" className="text-sm text-muted-foreground">
          {running
            ? "Encoding and decoding local samples…"
            : media?.recording
              ? "Audio/video export and decode passed"
              : media
                ? "Media checks finished with limitations"
                : "Not checked on this browser yet"}
        </p>
        {media && (
          <pre
            data-testid="media-result"
            className="overflow-auto rounded-md bg-muted p-4 text-xs leading-6"
          >
            {JSON.stringify(media, null, 2)}
          </pre>
        )}
        {download && (
          <a
            className="inline-block text-sm underline"
            href={download}
            download={`sidecut-media-probe.${media?.recording?.mimeType.includes("mp4") ? "mp4" : "webm"}`}
          >
            Download synthetic video
          </a>
        )}
      </section>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </main>
  );
}
