import { describe, it, expect } from "vite-plus/test";
import { decodeProjectFile, encodeProjectFile } from "@sidecut/contracts/project";
import { serviceExportPlan } from "./service-export";
import { speechLevel } from "./audio-editing";
import { compareGains } from "./gain-follow";
import { modelProblems, frameStats, frameProblems, checkRanges } from "./quality-check";
import { reviewQuery } from "./service-review";
import { helperPlan } from "./service-speech";
import { ProjectCoordinator } from "./coordinator";
import { speechEnergy, speechLevels, auditCut } from "./cut-audit";
import contracts from "../../../tests/fixtures/tandem/render-review.json";
import { serviceRequest } from "./service-requests";
const fixture = () =>
  decodeProjectFile({
    revision: 0,
    project: {
      id: "finishing",
      settings: { width: 320, height: 180 },
      media: [{ id: "m", path: "voice.wav", kind: "audio", hasAudio: true, duration: 10 }],
      videoTracks: [
        {
          id: "v",
          kind: "video",
          name: "Graphics",
          clips: [
            {
              id: "solid",
              duration: 6,
              content: { solid: { color: { r: 0.1, g: 0.4, b: 0.7, a: 1 } } },
            },
          ],
        },
      ],
      audioTracks: [
        {
          id: "voice",
          kind: "audio",
          name: "Voice",
          rippleMode: "cut",
          clips: [{ id: "speech", duration: 6, content: { media: { mediaID: "m" } } }],
        },
      ],
      markers: [{ id: "section", kind: "section", name: "Next", time: 3, note: "Subtitle" }],
    },
  });
describe("123.04, 125.02-03, 126.01-02 reference follow-ups", () => {
  it("matches pinned request/result fixtures and rejects malformed or incompatible requests", () => {
    const file = fixture();
    for (const row of contracts.exports)
      expect(serviceExportPlan(file.project, row.request)).toMatchObject(row.expected);
    expect(reviewQuery(file, "validate", contracts.validate.request)).toMatchObject(
      contracts.validate.expected,
    );
    for (const row of contracts.failures) {
      const run = () =>
        row.operation === "export"
          ? serviceExportPlan(file.project, row.request)
          : row.operation === "check"
            ? checkRanges(file.project, row.request)
            : serviceRequest(row.operation, row.request);
      expect(run).toThrow();
      try {
        run();
      } catch (error) {
        expect(error).toMatchObject({ code: row.code });
      }
    }
  });
  it("plans reference sizes, default presets, aliases and area/frame-rate bitrates", () => {
    const project = fixture().project;
    expect(serviceExportPlan(project, {})).toMatchObject({
      preset: "youtube1080",
      width: 1920,
      height: 1080,
      codec: "h264",
      videoBitrate: 20000000,
      audioBitrate: 320000,
    });
    expect(serviceExportPlan(project, { preset: "YouTube 4K" })).toMatchObject({
      preset: "youtube4k",
      width: 3840,
      height: 2160,
      codec: "hevc",
      videoBitrate: 80000000,
    });
    expect(
      serviceExportPlan(
        {
          ...project,
          settings: {
            ...project.settings,
            width: 1080,
            height: 1080,
            frameRate: { numerator: 60, denominator: 1 },
          },
        },
        { preset: "youtube1080" },
      ),
    ).toMatchObject({ width: 1080, height: 1080, videoBitrate: 16900000 });
    expect(() => serviceExportPlan(project, { preset: "short" })).toThrow(/format/);
    expect(() => serviceExportPlan(project, { preset: "absent" })).toThrow(/Unknown/);
    expect(
      serviceExportPlan(
        { ...project, settings: { ...project.settings, width: 2160, height: 3840 } },
        { preset: "short" },
      ),
    ).toMatchObject({ width: 1080, height: 1920 });
    expect(project.settings.width).toBe(320);
    expect(serviceExportPlan(project, { preset: " YOUTUBE 4K " })).toMatchObject({ codec: "hevc" });
  });
  it("levels card sounds against duration-weighted speech rather than the default setting", () => {
    const file = fixture(),
      session = new ProjectCoordinator(file);
    session.apply({
      commands: [
        { updateClip: { clipID: "speech", patch: { audio: { normalizeTo: -28.7, gainDB: 0 } } } },
      ],
    });
    expect(speechLevel(session.getSnapshot().project)).toBe(-28.7);
    expect(speechLevel(file.project)).toBe(-20);
  });
  it("compares rendered gain, identifies delay and joins mismatch stretches", () => {
    expect(compareGains([0, 0, null], [0, 0, 10], 1)).toMatchObject({
      compared: 0.02,
      worstDB: 0,
      lateBy: null,
      mismatches: [],
    });
    const expected = Array.from({ length: 100 }, (_, i) => (i < 50 ? 0 : 12)),
      measured = Array.from({ length: 100 }, (_, i) => (i < 60 ? 0 : 12));
    expect(compareGains(expected, measured, 0)).toMatchObject({
      lateBy: 0.1,
      worstDB: 12,
      mismatches: [{ start: 0.5, end: 0.6, expectedDB: 12, measuredDB: 0 }],
    });
    expect(compareGains([null], [null], 0)).toMatchObject({
      compared: 0,
      worstDB: null,
      mismatches: [],
    });
  });
  it("validates without editing and returns ok for warnings but not errors", () => {
    const file = fixture(),
      before = encodeProjectFile(file);
    expect(reviewQuery(file, "validate", {})).toMatchObject({ revision: 0, ok: true });
    const missing = decodeProjectFile({
      revision: 2,
      project: {
        id: "missing",
        audioTracks: [
          {
            id: "a",
            kind: "audio",
            clips: [{ id: "c", duration: 1, content: { media: { mediaID: "absent" } } }],
          },
        ],
      },
    });
    expect(reviewQuery(missing, "validate", {})).toMatchObject({
      revision: 2,
      ok: false,
      issues: [expect.objectContaining({ severity: "error" })],
    });
    expect(encodeProjectFile(file)).toBe(before);
  });
  it("moves inserted cards into a known pause and reports missing transcripts without changing state", () => {
    const file = fixture(),
      before = encodeProjectFile(file),
      transcript = {
        model: "fixture",
        language: "en",
        words: [
          { text: "Before", start: 2, end: 2.4 },
          { text: "Next", start: 3, end: 3.4 },
        ],
      };
    const plan = helperPlan(file, "cards", { insert: true, sounds: false }, () => transcript);
    expect(plan).toMatchObject({
      cards: [{ markerID: "section", subtitle: "Subtitle", cut: 2.8 }],
      warnings: [expect.stringContaining("pause")],
    });
    expect(encodeProjectFile(file)).toBe(before);
    const session = new ProjectCoordinator(file);
    session.apply({ commands: plan.commands });
    session.undo();
    expect(encodeProjectFile({ revision: 0, project: session.getSnapshot().project })).toBe(before);
    expect(helperPlan(file, "cards", { insert: true }, () => undefined)).toMatchObject({
      warnings: [expect.stringContaining("No transcript")],
    });
    expect(() => helperPlan(file, "cards", { duration: 0.1 }, () => undefined)).toThrow(/at least/);
  });
  it("reports model gaps and softness and rejects conflicting check ranges", () => {
    const file = fixture();
    expect(modelProblems(file.project, [{ start: 0, end: 6 }])).toEqual([]);
    expect(
      modelProblems({ ...file.project, videoTracks: [] }, [{ start: 0, end: 6 }]),
    ).toMatchObject([{ kind: "gap", start: 0, end: 6 }]);
    expect(checkRanges(file.project, { changed: true }, [{ start: 2, end: 3 }])).toEqual([
      { start: 1.5, end: 3.5 },
    ]);
    expect(() => checkRanges(file.project, { changed: true, from: 0 })).toThrow(/not both/);
    expect(() => checkRanges(file.project, { cuts: true, quick: true })).toThrow(/does not take/);
  });
  it("measures pixels and finds black, green, brief white blocks and flickers without crossing range gaps", () => {
    const file = fixture(),
      color = (time: number, r: number, g: number, b: number) => {
        const pixels = new Uint8ClampedArray(160 * 90 * 4);
        for (let i = 0; i < pixels.length; i += 4) {
          pixels[i] = r;
          pixels[i + 1] = g;
          pixels[i + 2] = b;
          pixels[i + 3] = 255;
        }
        return frameStats(time, pixels, 160, 90);
      };
    const green = color(0, 0, 255, 0);
    expect(green.flatGreen).toBe(1);
    expect(frameProblems(file.project, [green], [])).toMatchObject([{ kind: "unkeyed" }]);
    expect(frameProblems(file.project, [color(0, 0, 0, 0)], [])).toMatchObject([
      { kind: "black", frames: 1 },
    ]);
    expect(
      frameProblems(
        file.project,
        [color(0, 80, 80, 80), color(1 / 30, 255, 255, 255), color(2 / 30, 80, 80, 80)],
        [],
      ),
    ).toMatchObject([{ kind: "whiteBlock", frames: 1 }]);
    expect(
      frameProblems(
        file.project,
        [color(0, 80, 80, 80), color(1 / 30, 150, 150, 150), color(2 / 30, 80, 80, 80)],
        [],
      ),
    ).toMatchObject([{ kind: "flicker", frames: 1 }]);
    expect(
      frameProblems(
        file.project,
        [color(0, 80, 80, 80), color(1, 150, 150, 150), color(2, 80, 80, 80)],
        [],
      ),
    ).toEqual([]);
  });
  it("audits full/high-band speech across cuts and leaves real pauses clean", () => {
    const samples = new Float32Array(32000 * 2);
    for (let i = 16000; i < 48000; i++)
      samples[i] = 0.2 * Math.sin((i * 2 * Math.PI * 500) / 32000);
    const energy = speechEnergy(samples),
      levels = speechLevels(energy);
    expect(auditCut(energy, levels, 1, "before").clipped).toBe(true);
    expect(auditCut(energy, levels, 0.2, "before").clipped).toBe(false);
    const silence = speechEnergy(new Float32Array(32000));
    expect(speechLevels(silence).isVoice).toBe(false);
  });
});
