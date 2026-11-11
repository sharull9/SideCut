import { createFileRoute } from "@tanstack/react-router";
import { CloudDashboard, cloudSections } from "@/modules/cloud/cloud-dashboard";

export const Route = createFileRoute("/cloud")({
  validateSearch: (search: Record<string, unknown>) => ({
    section: cloudSections.find((item) => item.id === search.section)?.id ?? "overview",
  }),
  component: CloudPage,
});

function CloudPage() {
  const { section } = Route.useSearch();
  return <CloudDashboard section={section} />;
}
