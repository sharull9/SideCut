import { describe, expect, it } from "vite-plus/test";
import { decodeProjectFile } from "@sidecut/contracts/project";
import type { Project } from "@sidecut/contracts/project";
import mini from "../../../tests/fixtures/tandem/mini.json";
import { Time } from "@sidecut/contracts/time";
import { validateProject } from "./validation";

const fixture = () => decodeProjectFile(mini).project;
const errors = (project: Project) =>
  validateProject(project).filter((issue) => issue.severity === "error");

describe("project invariants", () => {
  it("accepts the synthetic reference project", () => {
    expect(validateProject(fixture())).toEqual([]);
  });

  it("reports missing media and duplicate IDs on the affected object", () => {
    const project = fixture();
    expect(errors({ ...project, media: [] })).toContainEqual(
      expect.objectContaining({ code: "missing-media", objectID: "clip_camera" }),
    );
    expect(errors({ ...project, media: [...project.media, project.media[0]!] })).toContainEqual(
      expect.objectContaining({ code: "duplicate-id", objectID: "med_camera" }),
    );
  });

  it("rejects every overlap, even one sample, and detects unordered clips", () => {
    const project = fixture();
    const track = project.videoTracks[1]!;
    const clip = track.clips[0]!;
    const next = {
      ...clip,
      id: "clip_next",
      start: Time.fromSeconds(2 - 1 / 48_000),
      duration: Time.fromSeconds(0.5),
    };
    expect(errors({ ...project, videoTracks: [{ ...track, clips: [clip, next] }] })).toContainEqual(
      expect.objectContaining({ code: "clip-overlap", objectID: "clip_next" }),
    );
    expect(errors({ ...project, videoTracks: [{ ...track, clips: [next, clip] }] })).toContainEqual(
      expect.objectContaining({ code: "clip-order", objectID: "clip_camera" }),
    );
    expect(
      errors({
        ...project,
        videoTracks: [{ ...track, clips: [clip, { ...next, start: Time.fromSeconds(2) }] }],
      }),
    ).toEqual([]);
  });

  it("uses one-frame source tolerance and respects still/freeze/hold semantics", () => {
    const project = fixture();
    const track = project.videoTracks[1]!;
    const clip = track.clips[0]!;
    const withClip = (patch: Partial<typeof clip>) => ({
      ...project,
      videoTracks: [{ ...track, clips: [{ ...clip, ...patch }] }],
    });
    expect(errors(withClip({ sourceStart: Time.fromSeconds(1.02) }))).toEqual([]);
    expect(errors(withClip({ sourceStart: Time.fromSeconds(1.1) }))).toContainEqual(
      expect.objectContaining({ code: "source-end", objectID: clip.id }),
    );
    expect(errors(withClip({ sourceStart: Time.fromSeconds(-0.1) }))).toContainEqual(
      expect.objectContaining({ code: "source-start" }),
    );
    expect(errors(withClip({ sourceStart: Time.fromSeconds(-1), holdEdges: true }))).toEqual([]);
    expect(errors(withClip({ sourceStart: Time.fromSeconds(2.9), freezeFrame: true }))).toEqual([]);
    expect(
      errors(
        withClip({
          content: { media: { mediaID: "med_image" } },
          sourceStart: Time.fromSeconds(-10),
        }),
      ),
    ).toEqual([]);
    expect(
      errors(withClip({ start: Time.fromSeconds(-1), duration: Time.fromSeconds(0) })),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "clip-start" }),
        expect.objectContaining({ code: "clip-duration" }),
      ]),
    );
  });

  it("rejects track kinds and non-media audio while warning about singleton links", () => {
    const project = fixture();
    expect(errors({ ...project, audioTracks: [project.videoTracks[1]!] })).toContainEqual(
      expect.objectContaining({ code: "track-kind" }),
    );
    const title = project.videoTracks[4]!.clips[0]!;
    expect(
      errors({ ...project, audioTracks: [{ ...project.audioTracks[0]!, clips: [title] }] }),
    ).toContainEqual(expect.objectContaining({ code: "non-media-audio", objectID: "clip_title" }));
    expect(validateProject({ ...project, audioTracks: [] })).toContainEqual(
      expect.objectContaining({
        code: "single-link",
        severity: "warning",
        objectID: "clip_camera",
      }),
    );
    const noSound = {
      ...project,
      media: project.media.map((item) => ({ ...item, hasAudio: false })),
    };
    expect(errors(noSound)).toContainEqual(
      expect.objectContaining({ code: "no-sound", objectID: "clip_voice" }),
    );
  });

  it("validates transition attachments and sound references", () => {
    const project = fixture();
    const track = project.videoTracks[1]!;
    const transition = {
      id: "tr_bad",
      type: "dissolve",
      duration: 0,
      fromClipID: "clip_missing",
      soundClipID: "sound_missing",
    };
    expect(errors({ ...project, videoTracks: [{ ...track, transitions: [transition] }] })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "transition-duration", objectID: "tr_bad" }),
        expect.objectContaining({ code: "transition-clip", objectID: "tr_bad" }),
        expect.objectContaining({ code: "transition-sound", objectID: "tr_bad" }),
      ]),
    );
  });
});
