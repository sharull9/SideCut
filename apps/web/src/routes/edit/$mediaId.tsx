import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/modules/shell/app-shell";
import { EditFromCloud } from "@/modules/cloud/edit-from-cloud";

export const Route = createFileRoute("/edit/$mediaId")({ component: EditMedia });

function EditMedia() {
  const { mediaId } = Route.useParams();
  return (
    <AppShell>
      <EditFromCloud mediaId={mediaId} />
    </AppShell>
  );
}
