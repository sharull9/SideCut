import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/modules/shell/app-shell";
import { LibraryPage } from "@/modules/cloud/library-page";

export const Route = createFileRoute("/library")({ component: Library });

function Library() {
  return (
    <AppShell>
      <LibraryPage />
    </AppShell>
  );
}
