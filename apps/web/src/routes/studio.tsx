import StudioPanel from "@/modules/studio/studio-panel";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/studio")({
  component: RouteComponent,
});

function RouteComponent() {
  return <StudioPanel onBusy={() => {}} />;
}
