import { createFileRoute } from "@tanstack/react-router";
import { CloudUpcomingPage } from "@/modules/cloud/cloud-lazy";

export const Route = createFileRoute("/cloud/usage")({ component: CloudUsage });

function CloudUsage() {
  return <CloudUpcomingPage section="usage" />;
}
