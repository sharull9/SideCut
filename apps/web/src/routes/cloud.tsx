import { lazy, Suspense } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { cloudSections } from "@/modules/cloud/cloud-sections";

// The dashboard and its CSS load only when /cloud is opened.
const CloudDashboard = lazy(() =>
  import("@/modules/cloud/cloud-dashboard").then((m) => ({ default: m.CloudDashboard })),
);

export const Route = createFileRoute("/cloud")({
  validateSearch: (search: Record<string, unknown>) => ({
    section: cloudSections.find((item) => item.id === search.section)?.id ?? "overview",
  }),
  component: CloudPage,
});

function CloudPage() {
  const { section } = Route.useSearch();
  return (
    <Suspense fallback={<p role="status">Loading cloud…</p>}>
      <CloudDashboard section={section} />
    </Suspense>
  );
}
