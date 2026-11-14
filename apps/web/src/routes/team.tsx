import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/modules/shell/app-shell";
import { TeamPage } from "@/modules/cloud/team-page";

export const Route = createFileRoute("/team")({ component: Team });

function Team() {
  return (
    <AppShell>
      <TeamPage />
    </AppShell>
  );
}
