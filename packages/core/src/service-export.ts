// TandemRender/ExportPlan.swift and RenderAPI.swift at 735a9b8. See tests/fixtures/tandem/TANDEM-LICENSE.
import type { Project } from "@sidecut/contracts/project";
import { formatProject } from "./formats";
import { QueryError } from "./project-queries";
export function serviceExportPlan(
  source: Project,
  request: Record<string, unknown>,
  operation = "export",
) {
  const named = request.format as string | undefined;
  let format = named === "main" ? undefined : named;
  const originalPreset = String(request.preset ?? (operation === "clip" ? "review" : ""));
  const key = originalPreset.toLowerCase().replace(/[^a-z0-9]/g, "");
  const aliases: Record<string, string> = {
    youtube4k: "youtube4k",
    youtube1080p: "youtube1080",
    review720p: "review",
    short916: "short",
  };
  const presetName = aliases[key] ?? key;
  if (presetName === "short" && named == null) format = "portrait";
  if (
    format === "portrait" &&
    !source.settings.alternateFormats.some((f) => f.id === format) &&
    Math.abs(source.settings.width / source.settings.height - 9 / 16) < 0.001
  )
    format = undefined;
  if (format && !source.settings.alternateFormats.some((f) => f.id === format))
    throw new QueryError("notFound", `No output format "${format}". Add it before exporting.`);
  let project = formatProject(source, format);
  const preset =
    presetName ||
    (Math.min(project.settings.width, project.settings.height) > 1080
      ? "youtube4k"
      : "youtube1080");
  if (!["youtube4k", "youtube1080", "review", "short", "final", "webm"].includes(preset))
    throw new QueryError("notFound", `Unknown export preset "${preset}".`);
  const resolution =
    preset === "youtube4k"
      ? 2160
      : ["youtube1080", "short"].includes(preset)
        ? 1080
        : preset === "review"
          ? 720
          : null;
  const { width: frameWidth, height: frameHeight } = project.settings;
  const scale = resolution == null ? 1 : resolution / Math.min(frameWidth, frameHeight),
    even = (v: number) => Math.max(2, Math.round(v / 2) * 2);
  const width = even(frameWidth * scale),
    height = even(frameHeight * scale);
  if (Math.max(width, height) > 8192 || width * height > 16777216)
    throw new QueryError(
      "notImplemented",
      "Export is limited to 8192 pixels per side and 16 million pixels.",
    );
  const base = preset === "review" ? 5000000 : preset === "youtube4k" ? 80000000 : 20000000;
  const area = resolution == null ? 1 : (width * height) / ((resolution * resolution * 16) / 9);
  const highRate =
    project.settings.frameRate.numerator / project.settings.frameRate.denominator > 30.5 ? 1.5 : 1;
  const videoBitrate = Math.max(100000, Math.round((base * area * highRate) / 100000) * 100000);
  const codec: "hevc" | "h264" = preset === "youtube4k" ? "hevc" : "h264";
  const warnings =
    width > frameWidth || height > frameHeight
      ? [
          `${preset} upscales the ${frameWidth}x${frameHeight} frame to ${width}x${height}; upscaling adds no detail.`,
        ]
      : [];
  project = { ...project, settings: { ...project.settings, width, height } };
  return { project, preset, codec, videoBitrate, audioBitrate: 320000, width, height, warnings };
}
