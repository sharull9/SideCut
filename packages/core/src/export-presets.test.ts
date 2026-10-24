import { it, expect } from "vite-plus/test";
import { decodeProjectFile } from "@sidecut/contracts/project";
import { presetProject } from "./export-presets";
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
});
