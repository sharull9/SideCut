import { expect, it } from "vite-plus/test";
import { decodeProjectFile } from "@sidecut/contracts/project";
import { Time } from "@sidecut/contracts/time";
import { ProjectCoordinator } from "@sidecut/core/coordinator";
import { playheadTrim } from "./playhead-trim";

const fixture = () =>
  decodeProjectFile({
    revision: 0,
    project: {
      id: "trim",
      media: [
        {
          id: "source",
          path: "source.webm",
          kind: "video",
          duration: 20,
          hasVideo: true,
          hasAudio: true,
        },
      ],
      videoTracks: [
        {
          id: "take",
          kind: "video",
          rippleMode: "cut",
          clips: [
            {
              id: "picture",
              start: 2,
              duration: 4,
              linkGroup: "pair",
              content: { media: { mediaID: "source" } },
            },
          ],
        },
        {
          id: "overlay",
          kind: "video",
          rippleMode: "follow",
          clips: [
            {
              id: "overlay-clip",
              duration: 10,
              content: { solid: { color: { r: 0, g: 0, b: 1, a: 1 } } },
            },
          ],
        },
      ],
      audioTracks: [
        {
          id: "sound",
          kind: "audio",
          rippleMode: "off",
          clips: [
            {
              id: "voice",
              start: 2,
              duration: 4,
              linkGroup: "pair",
              content: { media: { mediaID: "source" } },
            },
          ],
        },
      ],
    },
  });
it("ripple trims the take and linked sound, moves the playhead to the new edit and undoes atomically", () => {
  const file = fixture(),
    coordinator = new ProjectCoordinator(file);
  const plan = playheadTrim({
    project: file.project,
    playhead: Time.fromSeconds(3),
    selected: [],
    edge: "start",
  });
  expect(plan).not.toBeNull();
  if (!plan) throw new Error("No plan");
  coordinator.apply({ label: plan.label, commands: plan.commands });
  expect(plan.playhead.seconds).toBe(2);
  for (const clip of [
    coordinator.getSnapshot().project.videoTracks[0]!.clips[0]!,
    coordinator.getSnapshot().project.audioTracks[0]!.clips[0]!,
  ]) {
    expect(clip.start.seconds).toBe(2);
    expect(clip.duration.seconds).toBe(3);
    expect(clip.sourceStart.seconds).toBe(1);
  }
  coordinator.undo();
  expect(coordinator.getSnapshot().project).toEqual(file.project);
});
it("respects a partial explicit linked selection and keeps end-trim playhead position", () => {
  const file = fixture(),
    coordinator = new ProjectCoordinator(file);
  const plan = playheadTrim({
    project: file.project,
    playhead: Time.fromSeconds(5),
    selected: ["picture"],
    edge: "end",
  });
  expect(plan?.commands[0]?.trim.includeLinked).toBe(false);
  if (!plan) throw new Error("No plan");
  coordinator.apply({ commands: plan.commands });
  expect(coordinator.getSnapshot().project.videoTracks[0]!.clips[0]!.duration.seconds).toBe(3);
  expect(coordinator.getSnapshot().project.audioTracks[0]!.clips[0]!.duration.seconds).toBe(4);
  expect(plan.playhead.seconds).toBe(5);
});
it("does not fall through to an overlay at a take boundary, but honors an explicit selection", () => {
  const project = fixture().project,
    playhead = Time.fromSeconds(2);
  expect(playheadTrim({ project, playhead, selected: [], edge: "start" })).toBeNull();
  expect(
    playheadTrim({ project, playhead, selected: ["overlay-clip"], edge: "start" })?.commands[0]
      ?.trim.clipID,
  ).toBe("overlay-clip");
});
