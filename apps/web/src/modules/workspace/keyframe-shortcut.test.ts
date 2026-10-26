import { it, expect } from "vite-plus/test";
import { decodeProjectFile } from "@sidecut/contracts/project";
import { ProjectCoordinator } from "@sidecut/core/coordinator";
import { toggleClipKeyframes } from "./keyframe-shortcut";
it("toggles native transform pairs and sound gain, retains the last removed value and undoes atomically", () => {
  const coordinator = new ProjectCoordinator(
    decodeProjectFile({
      revision: 0,
      project: {
        id: "keys",
        media: [{ id: "missing", path: "voice.wav", kind: "audio", duration: 3, hasAudio: true }],
        videoTracks: [
          {
            id: "v",
            kind: "video",
            clips: [
              {
                id: "picture",
                duration: 3,
                video: { transform: { scale: 2 } },
                content: { solid: { color: { r: 1, g: 0, b: 0, a: 1 } } },
              },
            ],
          },
        ],
        audioTracks: [
          {
            id: "a",
            kind: "audio",
            clips: [
              {
                id: "sound",
                duration: 3,
                audio: { gainDB: -6 },
                content: { media: { mediaID: "missing" } },
              },
            ],
          },
        ],
      },
    }),
  );
  const toggle = (id: string, time: number) =>
    coordinator.apply(toggleClipKeyframes(coordinator.getSnapshot().project, [id], time));
  toggle("picture", 1);
  let picture = coordinator.getSnapshot().project.videoTracks[0]!.clips[0]!;
  expect(Object.keys(picture.keyframes).sort()).toEqual([
    "video.transform.position",
    "video.transform.scale",
  ]);
  expect(picture.keyframes["video.transform.scale"]).toMatchObject([{ time: 1, value: 2 }]);
  toggle("picture", 1.01);
  picture = coordinator.getSnapshot().project.videoTracks[0]!.clips[0]!;
  expect(picture.keyframes["video.transform.scale"]).toBeUndefined();
  expect(picture.video?.transform).toMatchObject({ scale: 2 });
  coordinator.undo();
  expect(
    coordinator.getSnapshot().project.videoTracks[0]!.clips[0]!.keyframes["video.transform.scale"],
  ).toHaveLength(1);
  toggle("sound", 2);
  expect(
    coordinator.getSnapshot().project.audioTracks[0]!.clips[0]!.keyframes["audio.gainDB"],
  ).toMatchObject([{ time: 2, value: -6 }]);
});
