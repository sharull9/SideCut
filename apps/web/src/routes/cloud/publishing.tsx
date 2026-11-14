import { createFileRoute } from "@tanstack/react-router";
import { CloudUpcomingPage } from "@/modules/cloud/cloud-lazy";

export const Route = createFileRoute("/cloud/publishing")({ component: CloudPublishing });

function CloudPublishing() {
  return <CloudUpcomingPage section="publishing" />;
}
