import { createFileRoute, redirect } from "@tanstack/react-router";

// WorkOS Redirect URI: Team mounts AuthKitProvider, which completes sign-in from `code`/`state`.
export const Route = createFileRoute("/callback")({
  beforeLoad: ({ location }) => {
    throw redirect({
      to: "/team",
      search: location.search as Record<string, unknown>,
      replace: true,
    });
  },
});
