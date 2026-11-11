import { createFileRoute } from "@tanstack/react-router";
import { WorkspaceHome } from "@/modules/workspace/workspace-home";

type EditorSearch = { studio?: "open" };

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): EditorSearch =>
    search.studio === "open" ? { studio: "open" } : {},
  component: EditorRoute,
});

function EditorRoute() {
  const { studio } = Route.useSearch();
  return <WorkspaceHome studioOpen={studio === "open"} />;
}
