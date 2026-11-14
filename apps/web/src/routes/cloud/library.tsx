import { createFileRoute } from "@tanstack/react-router";
import { CloudConnectedPage } from "@/modules/cloud/cloud-lazy";

export const Route = createFileRoute("/cloud/library")({ component: CloudLibrary });

function CloudLibrary() {
  return <CloudConnectedPage section="library" />;
}
