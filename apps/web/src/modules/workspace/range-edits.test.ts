import { it, expect } from "vite-plus/test";
import { ProjectCoordinator } from "@sidecut/core/coordinator";
import { decodeProjectFile } from "@sidecut/contracts/project";
import { rangeEdit } from "./range-edits";
import { createEditorView } from "./editor-view";
it("lifts without shifting later clips/markers and extracts across all unlocked tracks", () => {
  const clip = {
    id: "c",
    start: 0,
    duration: 10,
    content: { solid: { color: { r: 0, g: 0, b: 0, a: 1 } } },
  };
  const file = decodeProjectFile({
    revision: 0,
    project: {
      id: "range",
      videoTracks: [
        { id: "v", kind: "video", rippleMode: "off", clips: [clip] },
        { id: "locked", kind: "video", locked: true, clips: [{ ...clip, id: "locked-clip" }] },
      ],
      markers: [{ id: "m", time: 3 }],
    },
  });
  const c = new ProjectCoordinator(file);
  c.apply(rangeEdit(file.project, 2, 4, false));
  expect(
    c
      .getSnapshot()
      .project.videoTracks[0]!.clips.map((item) => [item.start.seconds, item.duration.seconds]),
  ).toEqual([
    [0, 2],
    [4, 6],
  ]);
  expect(c.getSnapshot().project.markers[0]!.time).toBe(3);
  expect(c.getSnapshot().project.videoTracks[1]!.clips[0]!.duration.seconds).toBe(10);
  c.undo();
  c.apply(rangeEdit(file.project, 2, 4, true));
  expect(
    c
      .getSnapshot()
      .project.videoTracks[0]!.clips.map((item) => [item.start.seconds, item.duration.seconds]),
  ).toEqual([
    [0, 2],
    [2, 6],
  ]);
});
it("clears individual marks without substituting a sequence boundary", () => {
  const view = createEditorView();
  view.getState().setIn(2);
  view.getState().setOut(4);
  view.getState().setIn(null);
  expect(view.getState()).toMatchObject({ inPoint: null, outPoint: 4, range: null });
  view.getState().setIn(5);
  expect(view.getState().outPoint).toBeNull();
});
