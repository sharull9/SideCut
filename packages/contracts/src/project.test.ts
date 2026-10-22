import { describe, expect, it } from "vite-plus/test";
import { Schema } from "effect";
import empty from "../../../tests/fixtures/tandem/empty.json";
import mini from "../../../tests/fixtures/tandem/mini.json";
import {
  ClipSchema,
  MediaItemSchema,
  TrackSchema,
  decodeProjectFile,
  encodeProjectFile,
} from "./project";
import { Time } from "./time";

describe("Tandem project wire format", () => {
  it("reads the revision envelope and supplies reference defaults", () => {
    const { project, revision } = decodeProjectFile(empty);
    expect(revision).toBe(0);
    expect(project.id).toBe("prj_empty");
    expect(project.settings).toEqual({
      width: 3840,
      height: 2160,
      frameRate: { numerator: 30, denominator: 1 },
      sampleRate: 48000,
      loudnessTarget: -14,
      truePeakCeiling: -1,
      speechLoudness: -20,
      colorSpace: "rec709",
      alternateFormats: [],
    });
    expect(project.videoTracks).toEqual([]);
    expect(
      decodeProjectFile({ revision: 0, project: { name: null, settings: null } }).project.name,
    ).toBe("Untitled");
  });

  it("preserves every supported clip variant, paths, stable IDs and nested future data", () => {
    const raw = {
      ...mini,
      futureEnvelope: { keep: true },
      project: { ...mini.project, futureProject: [1, true] },
    };
    const file = decodeProjectFile(raw);
    const camera = file.project.videoTracks[1]?.clips[0];
    expect(camera?.duration).toBeInstanceOf(Time);
    expect(camera?.duration.flicks).toBe(1_411_200_000n);
    expect(camera?.sourceStart.seconds).toBe(0.5);
    expect(file.project.media[2]?.path).toBe("source/图像.png");
    expect(file.project.audioTracks[0]?.clips[0]?.linkGroup).toBe("link_take");
    const encoded = JSON.parse(encodeProjectFile(file));
    expect(encoded).toMatchObject(mini);
    expect(encoded.futureEnvelope).toEqual(raw.futureEnvelope);
    expect(encoded.project.futureProject).toEqual(raw.project.futureProject);
    expect(encoded.project.videoTracks[1].clips[0].video).toEqual(camera?.video);
    expect(decodeProjectFile(encoded)).toEqual(file);
    expect(file.project.videoTracks.map((t) => t.name)).toEqual([
      "Screen",
      "Camera",
      "B-roll",
      "Graphics",
      "Text",
    ]);
    expect(file.project.audioTracks.map((t) => t.name)).toEqual(["Voice", "Music", "SFX"]);
    expect(
      file.project.videoTracks.flatMap((t) => t.clips).map((c) => Object.keys(c.content)[0]),
    ).toEqual(["media", "graphic", "solid", "adjustment", "text"]);
  });

  it("matches dependent media and track defaults", () => {
    const decode = Schema.decodeUnknownSync(MediaItemSchema);
    expect(decode({ path: "voice.wav", kind: "audio" })).toMatchObject({
      hasAudio: true,
      hasVideo: false,
      role: "other",
    });
    expect(decode({ path: "picture.png", kind: "image" })).toMatchObject({
      hasAudio: false,
      hasVideo: true,
    });
    expect(decode({ path: "clip.mov", hasAudio: true })).toMatchObject({
      hasAudio: true,
      hasVideo: true,
    });
    expect(Schema.decodeUnknownSync(TrackSchema)({ kind: "audio" })).toMatchObject({
      name: "Audio",
      targeted: true,
      rippleMode: "cut",
    });
    expect(
      Schema.decodeUnknownSync(ClipSchema)({
        content: { media: { mediaID: "med_x" } },
        duration: 1,
      }),
    ).toMatchObject({ speed: 1, enabled: true, sourceStart: new Time(0n) });
  });

  it("rejects invalid settings and unsupported versions with a useful path or explanation", () => {
    for (const settings of [
      { width: 0 },
      { height: "720" },
      { frameRate: { numerator: 30, denominator: 0 } },
      { sampleRate: Infinity },
    ]) {
      expect(() => decodeProjectFile({ revision: 0, project: { settings } })).toThrow();
    }
    expect(() => decodeProjectFile({ revision: 0, project: { settings: { width: 0 } } })).toThrow(
      /width/,
    );
    for (const version of [0, 3, 99]) {
      expect(() => decodeProjectFile({ revision: 0, project: { schemaVersion: version } })).toThrow(
        /Unsupported Tandem schema version/,
      );
    }
    expect(() => decodeProjectFile(mini.project)).toThrow();
  });

  it("keeps generated IDs stable and rejects non-JSON extensions", () => {
    const file = decodeProjectFile({ revision: 0, project: {} });
    expect(file.project.id).toMatch(/^prj_/);
    expect(decodeProjectFile(JSON.parse(encodeProjectFile(file))).project.id).toBe(file.project.id);
    expect(() => decodeProjectFile({ revision: 0, project: { extra: 1n } })).toThrow();
    expect(() => encodeProjectFile({ ...file, extra: Infinity })).toThrow();
  });

  it("never silently drops unknown or ambiguous content variants", () => {
    for (const content of [
      { future: {} },
      { text: { text: "Hi" }, adjustment: {} },
      {},
      { media: {} },
    ]) {
      expect(() => Schema.decodeUnknownSync(ClipSchema)({ content, duration: 1 })).toThrow();
    }
    expect(() =>
      Schema.decodeUnknownSync(MediaItemSchema)({ path: "x", kind: "future" }),
    ).toThrow();
  });
});
