import { createFileRoute } from "@tanstack/react-router";
import { CloudConnectedPage } from "@/modules/cloud/cloud-lazy";

export const Route = createFileRoute("/cloud/team")({ component: CloudTeam });

function CloudTeam() {
  return <CloudConnectedPage section="team" />;
}
