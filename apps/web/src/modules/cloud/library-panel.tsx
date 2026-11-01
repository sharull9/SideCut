import { useState } from "react";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import type { FunctionArgs } from "convex/server";
import { api } from "@sidecut/cloud/api";
import { LibraryBrowser, type LibraryFilter } from "./library-browser";

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
  return (
    <LibraryBrowser
      items={status === "LoadingFirstPage" ? undefined : results}
      folders={folders}
      filter={filter}
      onFilter={setFilter}
      readOnly={readOnly}
      createFolder={(name) => create({ teamId, name })}
      bulk={(operation) => bulk({ teamId, ...operation })}
      pagination={{ status, loadMore: () => loadMore(25) }}
    />
  );
}
