import { decodeProjectFile } from "@sidecut/contracts/project";
import { ProjectCoordinator } from "./coordinator";
export type ObjectValue = Record<string, unknown>;
export function object(value: unknown): ObjectValue {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected a JSON object.");
  return value as ObjectValue;
}
export function list(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("Expected a JSON array.");
  return value;
}
export function number(value: unknown, fallback?: number): number {
  if (value == null && fallback !== undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new Error("Expected a finite number.");
  return value;
}
export function text(value: unknown): string {
  if (typeof value !== "string" || !value) throw new Error("Expected nonempty text.");
  return value;
}
export interface ImportReport {
  format: "edl" | "filmora";
  warnings: string[];
  clips: number;
  media: number;
}
export function builder(name: string, settings: ObjectValue) {
  const coordinator = new ProjectCoordinator(
    decodeProjectFile({
      revision: 0,
      project: {
        id: `prj_${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`,
        name,
      },
    }),
  );
  const commands: unknown[] = [{ updateSettings: { patch: settings } }];
  const warnings: string[] = [];
  let clips = 0,
    media = 0;
  return {
    commands,
    warnings,
    track(id: string, kind: string, trackName: string) {
      commands.push({ addTrack: { id, kind, name: trackName } });
    },
    media(item: ObjectValue) {
      commands.push({ addMedia: { item } });
      media++;
    },
    clip(trackID: string, clip: ObjectValue) {
      commands.push({ insertClip: { trackID, clip } });
      clips++;
    },
    finish(format: ImportReport["format"]) {
      commands.push({
        updateProject: {
          patch: {
            metadata: { sidecutImportReport: JSON.stringify({ format, warnings, clips, media }) },
          },
        },
      });
      coordinator.apply({ label: `Import ${format}`, expectedRevision: 0, commands });
      return {
        file: coordinator.projectFile(),
        report: { format, warnings, clips, media } satisfies ImportReport,
      };
    },
  };
}
