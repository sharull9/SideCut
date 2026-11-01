import { describe, expect, it } from "vite-plus/test";
import collection from "../../../tests/fixtures/obs/collection.json";
import { importOBS, obsCollection, obsProfile } from "./obs-import";
import { LiveStudio } from "./live-studio";
import { layerGeometry, sourceCrop, framePlan } from "./render-plan";
import { encodeProjectFile, decodeProjectFile } from "@sidecut/contracts/project";

const profile =
  "[Video]\nBaseCX=320\nBaseCY=180\nFPSType=2\nFPSNum=30000\nFPSDen=1001\n[Stream1]\nKey=PRIVATE_PROFILE_SECRET";
const images = new Map([["Logo", { path: "assets/logo.png", width: 16, height: 16 }]]);
const load = () => importOBS(structuredClone(collection), { profile, images, duration: 3 });

describe("documented OBS scene/profile subset", () => {
  it("preserves scene order, selected scene, visibility, lock state and rational frame rate", () => {
    const { file, report } = load();
    expect(file.project.settings).toMatchObject({
      width: 320,
      height: 180,
      frameRate: { numerator: 30000, denominator: 1001 },
    });
    expect(file.project.videoTracks.map((t) => t.name)).toEqual([
      "Background",
      "Panel",
      "Logo",
      "Hidden",
    ]);
    expect(file.project.videoTracks[2]?.locked).toBe(true);
    expect(file.project.videoTracks[3]?.clips[0]?.enabled).toBe(false);
    expect(framePlan(file.project, 1).layers.map((layer) => layer.clip.name)).toEqual([
      "Background",
      "Panel",
      "Logo",
    ]);
    expect(report).toMatchObject({
      format: "obs",
      clips: 4,
      media: 1,
      scenes: 2,
      selectedScene: "Main",
      duration: 3,
    });
    const studio = LiveStudio.restore(file.project.metadata["sidecut.liveStudio"]!);
    expect(studio.list().map((scene) => scene.name)).toEqual(["Other", "Main"]);
    expect(studio.frame(0).sceneId).toBe("obs_scene_1");
    expect(encodeProjectFile(decodeProjectFile(JSON.parse(encodeProjectFile(file))))).toBe(
      encodeProjectFile(file),
    );
    expect(encodeProjectFile(file)).not.toContain("PRIVATE_");
  });
  it("maps source crop, alignment and uniform scale into actual editor geometry", () => {
    const { file } = load();
    const panel = file.project.videoTracks[1]!.clips[0]!;
    const geometry = layerGeometry(panel, 320, 180, 320, 180);
    const crop = sourceCrop(panel, 320, 180);
    expect(geometry.x - geometry.width / 2 + (crop.x / 320) * geometry.width).toBeCloseTo(20);
    expect(geometry.y - geometry.height / 2 + (crop.y / 180) * geometry.height).toBeCloseTo(30);
    expect((crop.width / 320) * geometry.width).toBeCloseTo(80);
    expect((crop.height / 180) * geometry.height).toBeCloseTo(50);
    const logo = layerGeometry(file.project.videoTracks[2]!.clips[0]!, 320, 180, 16, 16);
    expect(logo).toMatchObject({ x: 216, y: 36, width: 32, height: 32 });
    const rotated = structuredClone(collection);
    Object.assign(rotated.sources.find((s) => s.name === "Main")!.settings.items![1]!, {
      rot: 90,
      align: 0,
    });
    const transformed = importOBS(rotated, { profile, images }).file.project.videoTracks[1]!
      .clips[0]!;
    expect(layerGeometry(transformed, 320, 180, 320, 180).radians).toBeCloseTo(Math.PI / 2);
    expect(transformed.video?.transform).toMatchObject({ rotation: 90 });
  });
  it("reports unsupported sources/filters/transforms and rejects an empty selected scene", () => {
    const { report } = importOBS(collection, { profile });
    expect(report.warnings.join("\n")).toMatch(/Browser.*Unsupported source type browser_source/);
    expect(report.warnings.join("\n")).toMatch(/Filtered.*filters unsupported/);
    expect(report.warnings.join("\n")).toMatch(/nonuniform scale/);
    expect(report.warnings.join("\n")).toMatch(/Logo.*approved local PNG/);
    expect(importOBS(collection, { profile, scene: "Other" }).report.selectedScene).toBe("Other");
    const empty = structuredClone(collection);
    const emptyScene = empty.sources.find((s) => s.name === "Main")!;
    emptyScene.settings.items = [
      emptyScene.settings.items!.find((item) => item.source_uuid === "browser")!,
    ];
    expect(() => importOBS(empty, { profile })).toThrow(/no supported items/);
  });
  it("validates duplicate IDs, bounded input, profile formats and unsafe resource metadata", () => {
    expect(
      obsProfile("[Video]\nBaseCX=320\nBaseCY=180\nFPSType=0\nFPSCommon=29.97").settings.frameRate,
    ).toEqual({ numerator: 30000, denominator: 1001 });
    expect(obsProfile().warnings[0]).toMatch(/No OBS profile/);
    expect(() => obsProfile("[Video]\nBaseCX=320\nBaseCX=640")).toThrow(/Duplicate/);
    expect(() => obsProfile("[Video]\nFPSType=2\nFPSDen=0")).toThrow(/frame rate/);
    expect(() => obsProfile("[Video]\nBaseCX=99999")).toThrow(/4K/);
    expect(() =>
      obsCollection({ ...collection, sources: [...collection.sources, collection.sources[0]] }),
    ).toThrow(/uniquely named/);
    expect(() => importOBS(collection, { profile, duration: Infinity })).toThrow(/duration/);
    expect(() => importOBS(collection, { profile, scene: "missing" })).toThrow(/unavailable/);
    expect(() =>
      importOBS(collection, {
        profile,
        images: new Map([["Logo", { path: "../private.png", width: 16, height: 16 }]]),
      }),
    ).toThrow(/Unsafe/);
  });
});
