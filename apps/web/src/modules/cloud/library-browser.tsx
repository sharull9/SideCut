import { useState } from "react";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import type { api } from "@sidecut/cloud/api";
import { Button } from "@sidecut/ui/components/button";
import { Input } from "@sidecut/ui/components/input";

export type LibraryFilter = Omit<FunctionArgs<typeof api.library.list>, "teamId">;
type Bulk = Omit<FunctionArgs<typeof api.library.bulk>, "teamId">;
type Items = FunctionReturnType<typeof api.library.list>;
type Folders = FunctionReturnType<typeof api.library.folders>;

export type LibraryBrowserProps = {
  items: Items | undefined;
  folders: Folders | undefined;
  filter: LibraryFilter;
  onFilter: (filter: LibraryFilter) => void;
  readOnly: boolean;
  createFolder: (name: string) => Promise<unknown>;
  bulk: (operation: Bulk) => Promise<unknown>;
  /** Opens a file in the editor; omitted where there is no editor to open it in. */
  onEdit?: (mediaId: Items[number]["_id"]) => void;
  pagination?: {
    status: "LoadingFirstPage" | "CanLoadMore" | "LoadingMore" | "Exhausted";
    loadMore: () => void;
  };
};

export function LibraryBrowser({
  items,
  folders,
  filter,
  onFilter,
  readOnly,
  createFolder,
  bulk,
  onEdit,
  pagination,
}: LibraryBrowserProps) {
  const [selected, setSelected] = useState(new Set<Items[number]["_id"]>());
  const [destination, setDestination] = useState<Folders[number]["_id"] | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const visibleSelected =
    items?.filter((item) => selected.has(item._id)).map((item) => item._id) ?? [];
  const changeFilter = (next: LibraryFilter) => {
    setSelected(new Set());
    setError("");
    setMessage("");
    onFilter(next);
  };
  async function run(action: () => Promise<unknown>, success: string) {
    if (busy || readOnly) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await action();
      setSelected(new Set());
      setMessage(success);
    } catch {
      setError("The library update failed. Your selection was kept. Try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-labelledby="cloud-library-heading" className="grid gap-4 border-t pt-4">
      <div className="space-y-1">
        <h3 id="cloud-library-heading" className="font-medium">
          Cloud library
        </h3>
        <p className="text-sm text-muted-foreground">
          Manage files shared with this team. Local projects stay on this device.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm">
          Search library
          <Input
            type="search"
            value={filter.search ?? ""}
            maxLength={200}
            disabled={busy}
            onChange={(event) => changeFilter({ ...filter, search: event.target.value })}
          />
        </label>
        <label className="grid gap-1 text-sm">
          Library folder
          <select
            className="h-9 min-w-0 rounded-md border bg-background px-2"
            value={filter.folderId ?? ""}
            disabled={busy || !folders}
            onChange={(event) => {
              const next = { ...filter };
              const folder = folders?.find((candidate) => candidate._id === event.target.value);
              if (folder) next.folderId = folder._id;
              else delete next.folderId;
              changeFilter(next);
            }}
          >
            <option value="">All folders</option>
            {folders?.map((folder) => (
              <option key={folder._id} value={folder._id}>
                {folder.name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          Library order
          <select
            className="h-9 rounded-md border bg-background px-2"
            value={filter.search?.trim() ? "relevance" : filter.sort}
            disabled={busy || Boolean(filter.search?.trim())}
            onChange={(event) =>
              changeFilter({ ...filter, sort: event.target.value === "name" ? "name" : "newest" })
            }
          >
            {filter.search?.trim() && <option value="relevance">Search relevance</option>}
            <option value="newest">Newest first</option>
            <option value="name">Name</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={filter.archived ?? false}
            disabled={busy}
            onChange={(event) => changeFilter({ ...filter, archived: event.target.checked })}
          />
          Show archived files
        </label>
      </div>
      {readOnly && (
        <p className="text-sm text-muted-foreground">
          You have viewing access. Ask a team editor to organize files.
        </p>
      )}
      {!readOnly && (
        <form
          className="flex items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget,
              name = new FormData(form).get("folderName");
            if (typeof name === "string" && name.trim())
              void run(async () => {
                await createFolder(name);
                form.reset();
              }, "Folder created.");
          }}
        >
          <label className="grid min-w-0 flex-1 gap-1 text-sm">
            New library folder
            <Input name="folderName" required maxLength={200} disabled={busy} />
          </label>
          <Button type="submit" variant="outline" disabled={busy}>
            Create folder
          </Button>
        </form>
      )}
      {!items || !folders ? (
        <p role="status">Loading library…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {filter.search
            ? "No files match this search."
            : filter.archived
              ? "No archived files in this view."
              : "No cloud files in this view yet."}
        </p>
      ) : (
        <ul className="grid max-h-72 gap-2 overflow-y-auto" aria-label="Cloud files">
          {items.map((item) => (
            <li key={item._id} className="flex min-w-0 items-start gap-2 rounded-md border p-3">
              {!readOnly && (
                <input
                  type="checkbox"
                  aria-label={`Select ${item.name}`}
                  className="mt-1"
                  checked={selected.has(item._id)}
                  disabled={busy || (!selected.has(item._id) && visibleSelected.length >= 100)}
                  onChange={(event) =>
                    setSelected((previous) => {
                      const next = new Set(previous);
                      if (event.target.checked) next.add(item._id);
                      else next.delete(item._id);
                      return next;
                    })
                  }
                />
              )}
              <div className="min-w-0 flex-1">
                <p className="break-words text-sm font-medium">{item.name}</p>
                <p className="text-xs text-muted-foreground">
                  {folders.find((folder) => folder._id === item.folderId)?.name ?? "No folder"}
                  {item.archived ? " · Archived" : ""}
                </p>
              </div>
              {onEdit && !item.archived && (
                <Button
                  size="sm"
                  variant="outline"
                  aria-label={`Open ${item.name} in the editor`}
                  onClick={() => onEdit(item._id)}
                >
                  Open in editor
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {pagination && pagination.status !== "Exhausted" && (
        <Button
          variant="outline"
          disabled={busy || pagination.status !== "CanLoadMore"}
          onClick={pagination.loadMore}
        >
          {pagination.status === "CanLoadMore" ? "Load more files" : "Loading files…"}
        </Button>
      )}
      {!readOnly && (
        <div className="grid gap-2">
          <p className="text-sm" role="status">
            {visibleSelected.length} selected
            {visibleSelected.length === 100 ? " (selection limit reached)" : ""}
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <label className="grid min-w-0 gap-1 text-sm">
              Move selected to
              <select
                className="h-9 max-w-full rounded-md border bg-background px-2"
                value={destination ?? ""}
                disabled={busy || !visibleSelected.length}
                onChange={(event) =>
                  setDestination(folders?.find((folder) => folder._id === event.target.value)?._id)
                }
              >
                <option value="">No folder</option>
                {folders?.map((folder) => (
                  <option key={folder._id} value={folder._id}>
                    {folder.name}
                  </option>
                ))}
              </select>
            </label>
            <Button
              variant="outline"
              disabled={busy || !visibleSelected.length}
              onClick={() =>
                void run(
                  () =>
                    bulk({
                      mediaIds: visibleSelected,
                      operation: "move",
                      ...(destination ? { folderId: destination } : {}),
                    }),
                  "Files moved.",
                )
              }
            >
              Move selected
            </Button>
            <Button
              variant="outline"
              disabled={busy || !visibleSelected.length}
              onClick={() =>
                void run(
                  () =>
                    bulk({
                      mediaIds: visibleSelected,
                      operation: filter.archived ? "restore" : "archive",
                    }),
                  filter.archived ? "Files restored." : "Files archived.",
                )
              }
            >
              {filter.archived ? "Restore selected" : "Archive selected"}
            </Button>
          </div>
        </div>
      )}
      {busy && <p role="status">Updating library…</p>}
      {message && <p role="status">{message}</p>}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
