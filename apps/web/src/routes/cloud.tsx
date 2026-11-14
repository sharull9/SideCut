import { Suspense } from "react";
import { Outlet, createFileRoute } from "@tanstack/react-router";
import { CloudLayout } from "@/modules/cloud/cloud-lazy";

// Layout for every /cloud page: the sidebar stays mounted while the section page changes.
export const Route = createFileRoute("/cloud")({ component: CloudFrame });

function CloudFrame() {
  return (
    <Suspense fallback={<p role="status">Loading cloud…</p>}>
      <CloudLayout>
        <Suspense fallback={<p role="status">Loading…</p>}>
          <Outlet />
        </Suspense>
      </CloudLayout>
    </Suspense>
  );
}
