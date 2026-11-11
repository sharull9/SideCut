import { createFileRoute, redirect } from "@tanstack/react-router";

// The studio opens as a dialog on the editor. This route keeps old and shared /studio links working.
export const Route = createFileRoute("/studio")({
  beforeLoad: () => {
    throw redirect({ to: "/", search: { studio: "open" } });
  },
});
