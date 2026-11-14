import {
  RiChatCheckLine,
  RiDashboardLine,
  RiFolderVideoLine,
  RiGroupLine,
  RiPieChartLine,
  RiSendPlaneLine,
} from "@remixicon/react";

// Kept apart from cloud-dashboard.tsx so the /cloud routes can redirect legacy links
// without loading the dashboard. Each section is its own page under /cloud.
export const cloudSections = [
  { id: "overview", to: "/cloud", label: "Overview", icon: RiDashboardLine },
  { id: "library", to: "/cloud/library", label: "Library", icon: RiFolderVideoLine },
  { id: "team", to: "/cloud/team", label: "Team", icon: RiGroupLine },
  { id: "reviews", to: "/cloud/reviews", label: "Reviews", icon: RiChatCheckLine },
  { id: "publishing", to: "/cloud/publishing", label: "Publishing", icon: RiSendPlaneLine },
  { id: "usage", to: "/cloud/usage", label: "Usage", icon: RiPieChartLine },
] as const;

export type Section = (typeof cloudSections)[number]["id"];
