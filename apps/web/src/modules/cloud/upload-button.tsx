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
import { uploadToCloud, type UploadClient } from "./upload";

export type UploadSource = { file: Blob; name: string };

type TeamId = FunctionArgs<typeof api.library.create>["teamId"];
type MediaId = FunctionArgs<typeof api.versions.begin>["mediaId"];
type VersionId = FunctionArgs<typeof api.storage.start>["versionId"];

type Status =
  | { kind: "idle" }
  | { kind: "uploading"; percent: number }
  | { kind: "done" }
  | { kind: "error"; message: string };

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
  const createItem = useMutation(api.library.create);
  const begin = useMutation(api.versions.begin);
  const start = useAction(api.storage.start);
  const partUrl = useAction(api.storage.partUrl);
  const complete = useAction(api.storage.complete);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const controllerRef = useRef<AbortController | null>(null);

  // Stop an in-flight upload when the control unmounts (row removed, dialog closed).
  useEffect(() => () => controllerRef.current?.abort(), []);

  const client: UploadClient = {
    createItem: (args) => createItem({ teamId: args.teamId as TeamId, name: args.name }),
    begin: (args) => begin({ ...args, mediaId: args.mediaId as MediaId }),
    start: (args) => start({ versionId: args.versionId as VersionId }),
    partUrl: (args) => partUrl({ versionId: args.versionId as VersionId, part: args.part }),
    complete: (args) => complete({ versionId: args.versionId as VersionId }),
  };

  async function upload() {
    const controller = new AbortController();
    controllerRef.current = controller;
    setStatus({ kind: "uploading", percent: 0 });
    try {
      const source = await getFile();
      await uploadToCloud({
        file: source.file,
        name: source.name,
        teamId,
        client,
        signal: controller.signal,
        onProgress: ({ loaded, total }) =>
          setStatus({
            kind: "uploading",
            percent: total > 0 ? Math.floor((loaded / total) * 100) : 0,
          }),
      });
      setStatus({ kind: "done" });
    } catch (cause) {
      // Cancel aborts the signal; the rejection is the abort reason, not a failure.
      if (controller.signal.aborted) setStatus({ kind: "idle" });
      else setStatus({ kind: "error", message: cloudErrorMessage(cause, "Upload failed.") });
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  }

  if (status.kind === "uploading") {
    const cancel = () => controllerRef.current?.abort();
    return (
      <div className={compact ? "flex min-w-0 items-center gap-1.5" : "flex items-center gap-2"}>
        <span className="text-xs tabular-nums text-muted-foreground" role="status">
          Uploading {status.percent}%
        </span>
        {!compact && <Progress value={status.percent} className="w-32" />}
        <Button variant="ghost" size={compact ? "xs" : "sm"} onClick={cancel}>
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

  const trigger = compact ? (
    <Tip label="Upload to cloud">
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="Upload to cloud"
        onClick={() => void upload()}
      >
        <RiUploadCloud2Line />
      </Button>
    </Tip>
  ) : (
    <Button variant="outline" size="sm" onClick={() => void upload()}>
      <RiUploadCloud2Line />
      Upload to cloud
    </Button>
  );

  return (
    <div
      className={
        compact ? "flex min-w-0 items-center gap-1.5" : "flex flex-wrap items-center gap-2"
      }
    >
      {trigger}
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
