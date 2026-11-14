import { createFileRoute, redirect } from "@tanstack/react-router";
import { CloudOverviewPage } from "@/modules/cloud/cloud-lazy";
import { cloudSections } from "@/modules/cloud/cloud-sections";

export const Route = createFileRoute("/cloud/")({
  // Older links used /cloud?section=<id>; send them to that section's own page.
  beforeLoad: ({ location }) => {
    const section = (location.search as Record<string, unknown>).section;
    if (section === undefined) return;
    const to = cloudSections.find((item) => item.id === section)?.to ?? "/cloud";
    throw redirect({ to, replace: true });
  },
  component: CloudOverviewPage,
});
