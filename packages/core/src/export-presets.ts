import type { Project } from "@sidecut/contracts/project";
import { serviceExportPlan } from "./service-export";
export type ExportPreset = "webm" | "review" | "youtube1080" | "short";
export function exportPresetPlan(
  project: Project,
  preset: ExportPreset,
  format: string | null = null,
) {
  return serviceExportPlan(project, { preset, ...(format == null ? {} : { format }) });
}
export function presetProject(project: Project, preset: ExportPreset): Project {
  return exportPresetPlan(project, preset).project;
}
