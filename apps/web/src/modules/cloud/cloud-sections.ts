import {
  RiChatCheckLine,
  RiDashboardLine,
  RiFolderVideoLine,
  RiGroupLine,
  RiPieChartLine,
  RiSendPlaneLine,
} from "@remixicon/react";

// Kept apart from cloud-dashboard.tsx so the /cloud route can validate its search
// without loading the dashboard.
export const cloudSections = [
  { id: "overview", label: "Overview", icon: RiDashboardLine },
  { id: "library", label: "Library", icon: RiFolderVideoLine },
  { id: "team", label: "Team", icon: RiGroupLine },
  { id: "reviews", label: "Reviews", icon: RiChatCheckLine },
  { id: "publishing", label: "Publishing", icon: RiSendPlaneLine },
  { id: "usage", label: "Usage", icon: RiPieChartLine },
] as const;

export type Section = (typeof cloudSections)[number]["id"];
