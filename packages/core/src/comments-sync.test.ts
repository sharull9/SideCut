import { describe, it, expect } from "vite-plus/test";
import { decodeProjectFile, encodeProjectFile } from "@sidecut/contracts/project";
import { reviewQuery } from "./service-review";
import { ProjectCoordinator } from "./coordinator";
import { resolveServiceMedia, soundTargets, soundSyncPlan } from "./service-sync";
import { serviceRequest } from "./service-requests";
import { clipMediaID } from "./project-queries";
import fixtureContract from "../../../tests/fixtures/tandem/jobs-archive.json";

const fixture = () =>
  decodeProjectFile({
    revision: 0,
    project: {
      id: "sync-comments",
      media: [
        {
          id: "camera",
          path: "takes/camera.mp4",
          kind: "video",
          role: "camera",
          hasVideo: true,
          hasAudio: true,
          duration: 8,
        },
        {
          id: "mic",
          path: "takes/mic.wav",
          kind: "audio",
          role: "music",
          hasAudio: true,
          duration: 9,
        },
      ],
      videoTracks: [
        {
          id: "v",
          kind: "video",
          name: "Camera",
          clips: [
            {
              id: "camera-clip",
              linkGroup: "take",
              duration: 8,
              content: { media: { mediaID: "camera" } },
            },
          ],
        },
      ],
      audioTracks: [
        {
          id: "a",
          kind: "audio",
          name: "Voice",
          rippleMode: "cut",
          clips: [
            {
              id: "voice",
              linkGroup: "take",
              duration: 8,
              content: { media: { mediaID: "camera" } },
            },
          ],
        },
      ],
      markers: [
        { id: "comment", kind: "comment", time: 4, name: "Tighten this" },
        { id: "end", kind: "comment", time: 8, name: "End" },
      ],
    },
  });

describe("126.03 comments and 127.01 sync", () => {
  it("pins the five adapter requests to the reference and rejects unknown fields", () => {
    for (const entry of fixtureContract.requests) {
      expect(serviceRequest(entry.operation, entry.request)).toBeDefined();
      expect(() => serviceRequest(entry.operation, { ...entry.request, unknown: true })).toThrow(
        /Unknown/,
      );
    }
  });
  it("places four-second speech context, the comment boundary and top-first active clips", () => {
    const file = fixture(),
      before = encodeProjectFile(file);
    const result = reviewQuery(file, "comments", {}, undefined, () => ({
      model: "fixture",
      language: "en",
      words: [
        { text: "before", start: 2, end: 3 },
        { text: "at", start: 4, end: 5 },
        { text: "after", start: 6, end: 7 },
      ],
    }));
    expect(result).toMatchObject({
      comments: [
        {
          said: "before | at after",
          clips: [
            { track: "V1 Camera", clipID: "camera-clip" },
            { track: "A1 Voice", clipID: "voice" },
          ],
        },
        { clips: [] },
      ],
    });
    expect(reviewQuery(file, "comments", {}).comments?.[0]).not.toHaveProperty("said");
    expect(encodeProjectFile(file)).toBe(before);
  });
  it("resolves media/clip/path aliases and refuses invalid or ambiguous references", () => {
    const file = fixture();
    expect(resolveServiceMedia(file.project, ["camera", "camera-clip", "camera.mp4"])).toHaveLength(
      1,
    );
    expect(soundTargets(file, { files: ["mic"] }).reference.id).toBe("camera");
    expect(() => soundTargets(file, { files: ["mic"], to: "mic" })).toThrow(/itself/);
    expect(() => soundTargets(file, { files: ["mic"], delay: 0 })).toThrow(/either/);
    expect(() => resolveServiceMedia(file.project, ["missing"])).toThrow(/missing/);
    expect(serviceRequest("sync", { delay: -0.08 })).toEqual({ delay: -0.08 });
  });
  it("shifts take offsets, places the matching mic and undoes everything atomically", () => {
    const file = fixture(),
      { items, reference } = soundTargets(file, { files: ["mic"] });
    const plan = soundSyncPlan(file, reference, [
      { item: items[0]!, match: { offset: 0.25, confidence: 100, overlapStart: 0, overlapEnd: 8 } },
    ]);
    expect(plan.matches).toMatchObject([{ takeOffset: 0 }]);
    const coordinator = new ProjectCoordinator(file);
    coordinator.apply({ label: "Sync", commands: plan.commands });
    const project = coordinator.getSnapshot().project;
    expect(project.media.find((m) => m.id === "camera")?.takeOffset?.seconds).toBe(0.25);
    expect(project.media.find((m) => m.id === "mic")?.role).toBe("other");
    expect(project.audioTracks.flatMap((t) => t.clips).some((c) => clipMediaID(c) === "mic")).toBe(
      true,
    );
    coordinator.undo();
    expect(coordinator.getSnapshot().project).toEqual(file.project);
    expect(file.project.media[0]?.takeID).toBeUndefined();
  });
});
