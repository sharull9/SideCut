import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "../../packages/ui/src/styles/globals.css";
import { LibraryBrowser } from "../../apps/web/src/modules/cloud/library-browser.tsx";

const readOnly = new URLSearchParams(location.search).get("role") === "viewer";
async function request(body, signal) {
  const response = await fetch(`/__fixture/cloud-library?role=${readOnly ? "viewer" : "owner"}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) throw new Error("Fixture request failed");
  return response.json();
}
function Fixture() {
  const [filter, setFilter] = useState({ sort: "newest" });
  const [state, setState] = useState(null);
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setState(null);
    setError("");
    request({ operation: "list", filter }, controller.signal)
      .then(setState)
      .catch((cause) => {
        if (cause.name !== "AbortError") setError("Fixture loading failed");
      });
    return () => controller.abort();
  }, [filter, refresh]);
  async function mutate(body) {
    await request(body);
    setRefresh((value) => value + 1);
  }
  async function loadMore() {
    setLoadingMore(true);
    setError("");
    try {
      const next = await request({ operation: "list", filter, cursor: state.cursor });
      setState((previous) => ({ ...next, items: [...previous.items, ...next.items] }));
    } catch {
      setError("Fixture loading failed");
    } finally {
      setLoadingMore(false);
    }
  }
  return (
    <>
      <p className="mb-6 text-sm text-muted-foreground">
        Browser verification · local fixture data · {readOnly ? "viewer" : "owner"}
      </p>
      {error && <p role="alert">{error}</p>}
      <LibraryBrowser
        items={state?.items}
        folders={state?.folders}
        filter={filter}
        onFilter={setFilter}
        readOnly={readOnly}
        createFolder={(name) => mutate({ operation: "folder", name })}
        bulk={(operation) =>
          mutate({ ...operation, operation: "bulk", action: operation.operation })
        }
        pagination={{
          status: !state
            ? "LoadingFirstPage"
            : state.done
              ? "Exhausted"
              : loadingMore
                ? "LoadingMore"
                : "CanLoadMore",
          loadMore,
        }}
      />
    </>
  );
}
createRoot(document.getElementById("root")).render(<Fixture />);
