// Ported from TandemAPI/Short.swift. See tests/fixtures/tandem/TANDEM-LICENSE.
import type { ProjectFile } from "@sidecut/contracts/project";
import type { EditCommand } from "@sidecut/contracts/commands";
import { ProjectCoordinator } from "./coordinator";
import { PORTRAIT, isNineBySixteen, mediaIDOf, portraitSlot, type PortraitSlot } from "./formats";

export interface ShortPlan {
  revision: number;
  format: typeof PORTRAIT;
  placed: Partial<Record<PortraitSlot, number>>;
  commands: EditCommand[];
  label: string;
  warnings: string[];
}
/** The `short` dry run: a 9:16 alternate format with each media clip in its reference slot. */
export function planShort(file: Pick<ProjectFile, "project" | "revision">): ShortPlan {
  const project = file.project;
  const existing = project.settings.alternateFormats.find((f) => f.id === PORTRAIT.id);
  if (!existing && isNineBySixteen(project.settings.width, project.settings.height))
    throw new Error(
      `This project's canvas is already 9:16 (${project.settings.width}x${project.settings.height}), so it is the short and there's nothing to lay out.`,
    );
  const format = existing ?? PORTRAIT;
  const commands: EditCommand[] = [];
  if (!existing)
    commands.push({
      updateSettings: {
        patch: { alternateFormats: [...project.settings.alternateFormats, PORTRAIT] },
      },
    } as unknown as EditCommand);
  const groups: Partial<Record<PortraitSlot, string[]>> = {};
  const locked = new Set<string>();
  for (const track of project.videoTracks.filter((t) => !t.hidden))
    for (const clip of track.clips.filter((c) => c.enabled)) {
      const item = project.media.find((m) => m.id === mediaIDOf(clip));
      if (!item) continue;
      if (track.locked) {
        locked.add(track.name);
        continue;
      }
      (groups[portraitSlot(clip, item.role)] ??= []).push(clip.id);
    }
  for (const slot of ["top", "bottom", "full"] as const) {
    const ids = groups[slot];
    // The camera keeps its background in a short.
    if (ids?.length)
      commands.push({
        setFormatLayout: {
          clipIDs: ids,
          format: format.id,
          slot,
          ...(slot === "top" ? {} : { cutout: false }),
        },
      } as unknown as EditCommand);
  }
  const plan: ShortPlan = {
    revision: file.revision,
    format: { ...PORTRAIT, ...format },
    placed: Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, v.length])),
    commands,
    label: "Lay out the 9:16 short",
    warnings: locked.size
      ? [`Left clips on locked tracks alone: ${[...locked].sort().join(", ")}.`]
      : [],
  };
  if (commands.length) {
    const scratch = new ProjectCoordinator({ revision: file.revision, project });
    plan.warnings.push(
      ...scratch.apply({ label: plan.label, commands, expectedRevision: file.revision }).warnings,
    );
  }
  return plan;
}
