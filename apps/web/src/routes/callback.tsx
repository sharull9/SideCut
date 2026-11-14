import { createFileRoute } from "@tanstack/react-router";

// WorkOS Redirect URI: the root CloudProvider's AuthKit completes sign-in here, then its
// onRedirectCallback sends the user back to the page they started from.
export const Route = createFileRoute("/callback")({ component: SignInCallback });

function SignInCallback() {
  return (
    <main className="grid min-h-screen place-items-center p-6">
      <p role="status">Finishing sign-in…</p>
    </main>
  );
}
