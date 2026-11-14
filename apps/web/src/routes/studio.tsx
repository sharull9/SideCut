import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/modules/shell/app-shell";
import { StudioPage } from "@/modules/studio/studio-page";

export const Route = createFileRoute("/studio")({ component: Studio });

function Studio() {
  return (
    <AppShell>
      <StudioPage />
    </AppShell>
  );
}
