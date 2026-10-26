import { it, expect } from "vite-plus/test";
import { decodeProjectFile } from "@sidecut/contracts/project";
import { presetProject, exportPresetPlan } from "./export-presets";
import { exportPlan } from "./render-plan";
it("sizes review/1080 presets to even pixels while retaining the source project", () => {
  const project = decodeProjectFile({
    revision: 0,
    project: {
      id: "presets",
      settings: { width: 320, height: 180 },
      videoTracks: [
        {
          id: "v",
          kind: "video",
          clips: [
            { id: "solid", content: { solid: { color: { r: 0, g: 0, b: 1, a: 1 } } }, duration: 1 },
          ],
        },
      ],
    },
  }).project;
  expect(exportPlan(presetProject(project, "review"))).toMatchObject({ width: 1280, height: 720 });
  expect(exportPlan(presetProject(project, "youtube1080"))).toMatchObject({
    width: 1920,
    height: 1080,
  });
  expect(project.settings.width).toBe(320);
  expect(() => presetProject(project, "short")).toThrow("portrait");
  expect(exportPresetPlan(project, "youtube1080")).toMatchObject({
    videoBitrate: 20000000,
    width: 1920,
    height: 1080,
    warnings: [expect.stringContaining("upscales")],
  });
});
it("shares native rounding, format validation and full-resolution dimensions with the service", () => {
  const project = decodeProjectFile({
    revision: 0,
    project: {
      settings: {
        width: 3840,
        height: 2160,
        alternateFormats: [
          { id: "portrait", name: "Portrait", width: 1080, height: 1920 },
          { id: "square", name: "Square", width: 1001, height: 1001 },
        ],
      },
      videoTracks: [
        {
          id: "v",
          kind: "video",
          clips: [{ duration: 0.1, content: { solid: { color: { r: 0, g: 0, b: 0, a: 1 } } } }],
        },
      ],
    },
  }).project;
  expect(exportPlan(presetProject(project, "webm"), true)).toMatchObject({
    width: 3840,
    height: 2160,
    frameCount: 3,
  });
  expect(exportPresetPlan(project, "short")).toMatchObject({ width: 1080, height: 1920 });
  expect(exportPresetPlan(project, "webm", "square")).toMatchObject({ width: 1002, height: 1002 });
  expect(() => exportPresetPlan(project, "webm", "missing")).toThrow("No output format");
  expect(project.settings.width).toBe(3840);
});
