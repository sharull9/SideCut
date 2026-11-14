import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAuth } from "@workos-inc/authkit-react";
import { useAction, useConvexAuth } from "convex/react";
import type { GenericId } from "convex/values";
import { api } from "@sidecut/cloud/api";
import { Button } from "@sidecut/ui/components/button";
import { Progress } from "@sidecut/ui/components/progress";
import { AppPage } from "@/modules/shell/app-shell";
import { megabytes } from "@/modules/studio/cloud-upload";
import { addTakeToProject } from "@/modules/studio/place-take";
import { findCloudTake, removeTake, takeFile } from "@/modules/studio/take-store";
import { useEditorSession } from "@/modules/workspace/editor-session";
import { useCloud } from "./cloud-provider";
import { recordingMetadata } from "./recording-metadata";

export function EditFromCloud({ mediaId }: { mediaId: string }) {
  const { configured } = useCloud();
  return (
    <AppPage
      title="Open from cloud"
      description="Adds the original file to this project and places it at the end of the timeline."
    >
      {configured ? (
        <Download mediaId={mediaId as GenericId<"media">} />
      ) : (
        <p>Cloud is not configured for this app. Open files from this device in Edit.</p>
      )}
    </AppPage>
  );
}

type Phase =
  | { name: "waiting" }
  | { name: "downloading"; received: number; total: number; fileName: string }
  | { name: "importing"; fileName: string }
  | { name: "failed"; error: string };

function Download({ mediaId }: { mediaId: GenericId<"media"> }) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const { signIn } = useAuth();
  const sourceUrl = useAction(api.storage.sourceUrl);
  const { session, snapshot } = useEditorSession();
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>({ name: "waiting" });
  const [attempt, setAttempt] = useState(0);
  const projectLoading = snapshot.saveState === "loading";

  useEffect(() => {
    if (isLoading || !isAuthenticated || projectLoading) return;
    const abort = new AbortController();
    void (async () => {
      try {
        setPhase({ name: "waiting" });
        // A take recorded on this device is still on disk: open it without downloading.
        const local = await findCloudTake(mediaId).catch(() => undefined);
        if (local) {
          setPhase({ name: "importing", fileName: local.fileName });
          await addTakeToProject(session, await takeFile(local.fileName), local.marks);
          await removeTake(local.fileName);
          if (!abort.signal.aborted) void navigate({ to: "/", replace: true });
          return;
        }
        const source = await sourceUrl({ mediaId });
        const { fileName, type } = recordingMetadata(source.snapshot, source.name);
        const response = await fetch(source.url, { signal: abort.signal });
        if (!response.ok || !response.body)
          throw new Error(`Cloud storage refused the download (${response.status}).`);
        const total = Number(response.headers.get("content-length")) || 0;
        const reader = response.body.getReader();
        const chunks: Uint8Array<ArrayBuffer>[] = [];
        let received = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          received += value.byteLength;
          setPhase({ name: "downloading", received, total, fileName });
        }
        setPhase({ name: "importing", fileName });
        await addTakeToProject(session, new File(chunks, fileName, { type }), source.marks);
        if (!abort.signal.aborted) void navigate({ to: "/", replace: true });
      } catch (cause) {
        if (abort.signal.aborted) return;
        setPhase({
          name: "failed",
          error: cause instanceof Error ? cause.message : "The file could not be opened.",
        });
      }
    })();
    return () => abort.abort();
  }, [attempt, isAuthenticated, isLoading, mediaId, navigate, projectLoading, session, sourceUrl]);

  if (isLoading || projectLoading) return <p role="status">Getting ready…</p>;
  if (!isAuthenticated)
    return (
      <div className="grid justify-items-start gap-3">
        <p>Sign in to open this file from your team's library.</p>
        <Button onClick={() => void signIn()}>Sign in</Button>
      </div>
    );
  if (phase.name === "failed")
    return (
      <div role="alert" className="grid justify-items-start gap-3">
        <p>{phase.error}</p>
        <Button onClick={() => setAttempt((value) => value + 1)}>Try again</Button>
      </div>
    );
  if (phase.name === "downloading")
    return (
      <div className="grid max-w-md gap-2">
        <p role="status">
          Downloading {phase.fileName} · {megabytes(phase.received)}
          {phase.total ? ` of ${megabytes(phase.total)}` : ""}
        </p>
        {phase.total > 0 && <Progress value={(phase.received / phase.total) * 100} />}
      </div>
    );
  if (phase.name === "importing")
    return <p role="status">Adding {phase.fileName} to the project…</p>;
  return <p role="status">Finding the file…</p>;
}
