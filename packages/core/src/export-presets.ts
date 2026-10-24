import type { Project } from "@sidecut/contracts/project";
import { formatProject } from "./formats";
export type ExportPreset = "webm" | "review" | "youtube1080" | "short";
export function presetProject(project: Project, preset: ExportPreset): Project {
  if (preset === "short") return formatProject(project, "portrait");
  if (preset !== "review" && preset !== "youtube1080") return project;
  const scale =
    (preset === "review" ? 720 : 1080) / Math.min(project.settings.width, project.settings.height);
  return {
    ...project,
    settings: {
      ...project.settings,
      width: Math.max(2, Math.floor((project.settings.width * scale) / 2) * 2),
      height: Math.max(2, Math.floor((project.settings.height * scale) / 2) * 2),
    },
  };
}
