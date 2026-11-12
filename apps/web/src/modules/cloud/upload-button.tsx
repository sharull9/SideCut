import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useAction, useConvexAuth, useMutation } from "convex/react";
import type { FunctionArgs } from "convex/server";
import { RiUploadCloud2Line } from "@remixicon/react";
import { api } from "@sidecut/cloud/api";
import { Button, buttonVariants } from "@sidecut/ui/components/button";
import { Progress } from "@sidecut/ui/components/progress";
import { Tip } from "@sidecut/ui/components/tooltip";
import { useCloud } from "./cloud-provider";
import { cloudErrorMessage } from "./subscription-error";
import { discardPendingUpload, hasPendingUpload, uploadToCloud, type UploadClient } from "./upload";

export type UploadSource = { file: Blob; name: string };

type TeamId = FunctionArgs<typeof api.versions.beginUpload>["teamId"];
type MediaId = Exclude<FunctionArgs<typeof api.versions.beginUpload>["mediaId"], undefined>;
type FolderId = Exclude<FunctionArgs<typeof api.versions.beginUpload>["folderId"], undefined>;
type VersionId = FunctionArgs<typeof api.storage.start>["versionId"];

type Status =
  | { kind: "idle" }
  // An unfinished upload of this file exists. Nothing runs until the user resumes it.
  | { kind: "paused" }
  | { kind: "uploading"; percent: number; resuming: boolean }
  | { kind: "done" }
  | { kind: "error"; message: string; resumable: boolean };

// `compact` renders an icon-only trigger for dense rows. Status text stays small.
export function UploadToCloudButton({
  getFile,
  compact = false,
}: {
  getFile: () => Promise<UploadSource>;
  compact?: boolean;
}) {
  const { configured } = useCloud();
  // Convex hooks live below this gate: they must only render when cloud is configured.
  if (!configured) return null;
  return <UploadGate getFile={getFile} compact={compact} />;
}

function UploadGate({
  getFile,
  compact,
}: {
  getFile: () => Promise<UploadSource>;
  compact: boolean;
}) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const { activeTeamId } = useCloud();
  if (isLoading) return null;
  // Compact buttons repeat on every media row, so they stay hidden until upload is possible.
  if (compact && (!isAuthenticated || !activeTeamId)) return null;
  if (!isAuthenticated) return <SignInLink compact={compact} />;
  if (!activeTeamId) return <ChooseTeamLink compact={compact} />;
  return <UploadControl teamId={activeTeamId as TeamId} getFile={getFile} compact={compact} />;
}

function SignInLink({ compact }: { compact: boolean }) {
  return (
    <Link to="/cloud" search={{ section: "team" }} className={linkClass(compact)}>
      Sign in to upload
    </Link>
  );
}

function ChooseTeamLink({ compact }: { compact: boolean }) {
  return (
    <Link to="/cloud" search={{ section: "team" }} className={linkClass(compact)}>
      Choose a cloud team
    </Link>
  );
}

function linkClass(compact: boolean) {
  return compact
    ? "truncate text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
    : "text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground";
}

function UploadControl({
  teamId,
  getFile,
  compact,
}: {
  teamId: TeamId;
  getFile: () => Promise<UploadSource>;
  compact: boolean;
}) {
  const beginUpload = useMutation(api.versions.beginUpload);
  const start = useAction(api.storage.start);
  const uploadedParts = useAction(api.storage.uploadedParts);
  const partUrl = useAction(api.storage.partUrl);
  const complete = useAction(api.storage.complete);
  const abortUpload = useAction(api.storage.abort);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  // The picked file is kept from the first click, so Resume and Discard do not read it again.
  const sourceRef = useRef<UploadSource | null>(null);
  // Pause runs when the control unmounts (row removed, dialog closed). Cancel comes from the button.
  const pauseRef = useRef<AbortController | null>(null);
  const cancelRef = useRef<AbortController | null>(null);

  useEffect(() => () => pauseRef.current?.abort(), []);

  const client: UploadClient = {
    beginUpload: ({ mediaId, folderId, ...args }) =>
      beginUpload({
        ...args,
        teamId: args.teamId as TeamId,
        ...(mediaId ? { mediaId: mediaId as MediaId } : {}),
        ...(folderId ? { folderId: folderId as FolderId } : {}),
      }),
    start: (args) => start({ versionId: args.versionId as VersionId }),
    uploadedParts: (args) => uploadedParts({ versionId: args.versionId as VersionId }),
    partUrl: (args) => partUrl({ versionId: args.versionId as VersionId, part: args.part }),
    complete: (args) => complete({ versionId: args.versionId as VersionId }),
    abort: (args) => abortUpload({ versionId: args.versionId as VersionId }),
  };

  // `resume` skips the pending check: the user has already chosen to resume.
  async function run(resume: boolean) {
    const pause = new AbortController();
    const cancel = new AbortController();
    pauseRef.current = pause;
    cancelRef.current = cancel;
    setStatus({ kind: "uploading", percent: 0, resuming: resume });
    try {
      const source = sourceRef.current ?? (await getFile());
      sourceRef.current = source;
      if (cancel.signal.aborted) {
        setStatus({ kind: "idle" });
        return;
      }
      if (!resume && hasPendingUpload(teamId, source.file)) {
        setStatus({ kind: "paused" });
        return;
      }
      await uploadToCloud({
        file: source.file,
        name: source.name,
        teamId,
        client,
        signal: pause.signal,
        cancelSignal: cancel.signal,
        onProgress: ({ loaded, total }) =>
          setStatus({
            kind: "uploading",
            percent: total > 0 ? Math.floor((loaded / total) * 100) : 0,
            resuming: resume,
          }),
      });
      sourceRef.current = null;
      setStatus({ kind: "done" });
    } catch (cause) {
      if (cancel.signal.aborted) {
        // Cancel already aborted the server version and cleared the record.
        sourceRef.current = null;
        setStatus({ kind: "idle" });
      } else if (!pause.signal.aborted) {
        // A pause (unmount) keeps the record and sets no state on the detached control.
        const resumable = sourceRef.current
          ? hasPendingUpload(teamId, sourceRef.current.file)
          : false;
        setStatus({
          kind: "error",
          resumable,
          message: cloudErrorMessage(cause, "Upload failed."),
        });
      }
    } finally {
      if (pauseRef.current === pause) pauseRef.current = null;
      if (cancelRef.current === cancel) cancelRef.current = null;
    }
  }

  async function discard() {
    const source = sourceRef.current;
    sourceRef.current = null;
    if (source) await discardPendingUpload(teamId, source.file, client);
    setStatus({ kind: "idle" });
  }

  if (status.kind === "uploading") {
    return (
      <div className={compact ? "flex min-w-0 items-center gap-1.5" : "flex items-center gap-2"}>
        <span className="text-xs tabular-nums text-muted-foreground" role="status">
          {status.resuming ? "Resuming previous upload…" : "Uploading"} {status.percent}%
        </span>
        {!compact && <Progress value={status.percent} className="w-32" />}
        <Button
          variant="ghost"
          size={compact ? "xs" : "sm"}
          onClick={() => cancelRef.current?.abort()}
        >
          Cancel
        </Button>
      </div>
    );
  }

  if (status.kind === "done") {
    return (
      <div className={compact ? "flex min-w-0 items-center gap-1.5" : "flex items-center gap-2"}>
        <span className="text-xs text-muted-foreground" role="status">
          Uploaded to cloud.
        </span>
        <Link
          to="/cloud"
          search={{ section: "library" }}
          className={buttonVariants({ variant: "outline", size: compact ? "xs" : "sm" })}
        >
          View in cloud library
        </Link>
      </div>
    );
  }

  const resumable = status.kind === "paused" || (status.kind === "error" && status.resumable);
  const actionLabel = resumable ? "Resume upload" : "Upload to cloud";
  const onAction = () => void run(resumable);

  const trigger = compact ? (
    <Tip label={actionLabel}>
      <Button variant="ghost" size="icon-xs" aria-label={actionLabel} onClick={onAction}>
        <RiUploadCloud2Line />
      </Button>
    </Tip>
  ) : (
    <Button variant="outline" size="sm" onClick={onAction}>
      <RiUploadCloud2Line />
      {actionLabel}
    </Button>
  );

  return (
    <div
      className={
        compact ? "flex min-w-0 items-center gap-1.5" : "flex flex-wrap items-center gap-2"
      }
    >
      {trigger}
      {status.kind === "paused" && (
        <span role="status" className="text-xs text-muted-foreground">
          Unfinished upload found.
        </span>
      )}
      {resumable && (
        <Button variant="ghost" size={compact ? "xs" : "sm"} onClick={() => void discard()}>
          Discard
        </Button>
      )}
      {status.kind === "error" && (
        <span
          role="alert"
          className={
            compact ? "min-w-0 truncate text-xs text-destructive" : "text-sm text-destructive"
          }
          title={status.message}
        >
          {status.message}
        </span>
      )}
    </div>
  );
}
