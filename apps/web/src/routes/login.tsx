import { Suspense, lazy } from "react";
import { createFileRoute } from "@tanstack/react-router";

const LoginRedirect = lazy(() => import("@/modules/cloud/login-redirect"));

export const Route = createFileRoute("/login")({ component: LoginPage });

function LoginPage() {
  return (
    <main className="container mx-auto p-4 pt-16">
      <Suspense fallback={<p role="status">Redirecting to sign in…</p>}>
        <LoginRedirect />
      </Suspense>
    </main>
  );
}
