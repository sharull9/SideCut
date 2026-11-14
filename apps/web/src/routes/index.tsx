import { createFileRoute, redirect } from "@tanstack/react-router";
import { AppShell } from "@/modules/shell/app-shell";
import { WorkspaceHome } from "@/modules/workspace/workspace-home";

export const Route = createFileRoute("/")({
  // Older WorkOS setups register the site root as the Redirect URI; sign-in finishes on Team.
  beforeLoad: ({ location }) => {
    const search = location.search as Record<string, unknown>;
    if (search.code && search.state) throw redirect({ to: "/team", search, replace: true });
  },
  component: EditPage,
});

function EditPage() {
  return (
    <AppShell>
      <WorkspaceHome />
    </AppShell>
  );
}
