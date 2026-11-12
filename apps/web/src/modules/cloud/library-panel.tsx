import { useEffect, useRef, useState } from "react";
import { useAction, useMutation, usePaginatedQuery, useQuery } from "convex/react";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { Link } from "@tanstack/react-router";
import { api } from "@sidecut/cloud/api";
import { Button } from "@sidecut/ui/components/button";
import { useEditorSession } from "../workspace/editor-session";
import { LibraryBrowser, type LibraryFilter } from "./library-browser";
import { downloadToFile, isAbortError } from "./add-to-project";
import { cloudErrorMessage } from "./subscription-error";

type LibraryItem = FunctionReturnType<typeof api.library.list>[number];
type PlaybackVersionId = NonNullable<FunctionArgs<typeof api.storage.playbackUrl>["versionId"]>;

type AddProgress = {
  name: string;
  phase: "resolving" | "downloading" | "importing";
  loaded: number;
  total?: number | undefined;
};

type AddOutcome =
  | { kind: "added"; name: string }
  | { kind: "cancelled" }
  | { kind: "error"; message: string };

export function CloudLibrary({
  teamId,
  readOnly,
}: {
  teamId: FunctionArgs<typeof api.library.list>["teamId"];
  readOnly: boolean;
}) {
  const [filter, setFilter] = useState<LibraryFilter>({ sort: "newest" });
  const { results, status, loadMore } = usePaginatedQuery(
    api.library.page,
    { teamId, ...filter },
    { initialNumItems: 25 },
  );
  const folders = useQuery(api.library.folders, { teamId });
  const create = useMutation(api.library.createFolder);
  const bulk = useMutation(api.library.bulk);
  const original = useAction(api.storage.originalUrl);
  const playback = useAction(api.storage.playbackUrl);
  const { session, snapshot } = useEditorSession();
  const [progress, setProgress] = useState<AddProgress | null>(null);
  const [outcome, setOutcome] = useState<AddOutcome | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => () => controllerRef.current?.abort(), []);

  async function addToProject(item: LibraryItem, versionId: PlaybackVersionId) {
    if (controllerRef.current) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    setOutcome(null);
    setProgress({ name: item.name, phase: "resolving", loaded: 0 });
    try {
      // The original keeps its stored name and type. Playback is the fallback when it can't be resolved.
      let source: { url: string; fileName?: string };
      try {
        const resolved = await original({ mediaId: item._id, versionId });
        source = { url: resolved.url, fileName: resolved.fileName };
      } catch (cause) {
        if (controller.signal.aborted) throw cause;
        const { url } = await playback({ mediaId: item._id, versionId });
        source = { url };
      }
      if (controller.signal.aborted) throw new DOMException("Cancelled.", "AbortError");
      const file = await downloadToFile({
        ...source,
        name: item.name,
        signal: controller.signal,
        onProgress: ({ loaded, total }) =>
          setProgress({ name: item.name, phase: "downloading", loaded, total }),
      });
      setProgress({ name: item.name, phase: "importing", loaded: file.size, total: file.size });
      await session.importFiles([file]);
      setOutcome({ kind: "added", name: item.name });
    } catch (cause) {
      if (controller.signal.aborted || isAbortError(cause)) setOutcome({ kind: "cancelled" });
      else
        setOutcome({
          kind: "error",
          message: cloudErrorMessage(
            cause,
            "The file could not be added to the project. Try again.",
          ),
        });
    } finally {
      controllerRef.current = null;
      setProgress(null);
    }
  }

  function addBlockReason(item: LibraryItem): string | undefined {
    if (!item.readyVersionId) return "Not ready yet. Add it after processing finishes.";
    if (item.archived) return "Restore this file to add it to a project.";
    if (snapshot.readOnly)
      return "This project is read-only. Enable editing after the other tab closes.";
    if (snapshot.saveState === "loading") return "Wait for the project to finish loading.";
    if (snapshot.busy) return "Wait for the current file operation to finish.";
    if (progress) return "Another file is being added.";
    return undefined;
  }

  function renderItemAction(item: LibraryItem) {
    const blocked = addBlockReason(item);
    return (
      <div className="grid shrink-0 justify-items-end gap-1">
        <Button
          size="sm"
          variant="outline"
          disabled={Boolean(blocked)}
          aria-describedby={blocked ? `add-blocked-${item._id}` : undefined}
          onClick={() => {
            if (item.readyVersionId) void addToProject(item, item.readyVersionId);
          }}
        >
          Add to project
        </Button>
        {blocked && (
          <p
            id={`add-blocked-${item._id}`}
            className="max-w-44 text-right text-xs text-muted-foreground"
          >
            {blocked}
          </p>
        )}
      </div>
    );
  }

  const percent =
    progress?.total && progress.phase === "downloading"
      ? ` ${Math.min(100, Math.floor((progress.loaded / progress.total) * 100))}%`
      : "";
  const progressText = !progress
    ? ""
    : progress.phase === "importing"
      ? `Adding ${progress.name} to the project…`
      : progress.phase === "resolving"
        ? `Preparing ${progress.name}…`
        : `Downloading ${progress.name}…${percent}`;

  return (
    <>
      <LibraryBrowser
        items={status === "LoadingFirstPage" ? undefined : results}
        folders={folders}
        filter={filter}
        onFilter={setFilter}
        readOnly={readOnly}
        createFolder={(name) => create({ teamId, name })}
        bulk={(operation) => bulk({ teamId, ...operation })}
        pagination={{ status, loadMore: () => loadMore(25) }}
        renderItemAction={renderItemAction}
      />
      {progress && (
        <div className="grid justify-items-start gap-2 text-sm" role="status">
          <p>{progressText}</p>
          {progress.phase !== "importing" && (
            <Button size="sm" variant="outline" onClick={() => controllerRef.current?.abort()}>
              Cancel
            </Button>
          )}
        </div>
      )}
      {outcome?.kind === "added" && (
        <p role="status" className="text-sm">
          {outcome.name} was added to the project.{" "}
          <Link to="/" className="cloud-editor-link">
            Open in editor
          </Link>
        </p>
      )}
      {outcome?.kind === "cancelled" && (
        <p role="status" className="text-sm">
          Add to project cancelled.
        </p>
      )}
      {outcome?.kind === "error" && (
        <p role="alert" className="text-sm text-destructive">
          {outcome.message}
        </p>
      )}
    </>
  );
}
