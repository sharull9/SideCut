import { expect, it } from "vite-plus/test";
import { decodeProjectFile } from "@sidecut/contracts/project";
import { decodeAsset } from "@sidecut/contracts/assets";
import { ProjectCoordinator } from "./coordinator";
import { assetUsePlan, assetUses, projectCredits, recordAssetUse, creditsText } from "./asset-use";
const asset = decodeAsset({
  provider: "fixture",
  providerID: "picture",
  kind: "sticker",
  name: "Picture",
  width: 400,
  height: 200,
  duration: 2,
  licenceClass: "creditNeeded",
  creditLine: "Fixture author",
});
const file = () =>
  decodeProjectFile({
    revision: 0,
    project: {
      id: "use",
      settings: { width: 1920, height: 1080 },
      videoTracks: [{ id: "v", name: "Graphics", kind: "video", clips: [] }],
      audioTracks: [],
    },
  });
const resource = { mediaID: "m", path: "assets/sticker/picture.webm" };
it("adds, places and records provenance in one undo step with anchor/pop", () => {
  const coordinator = new ProjectCoordinator(file()),
    plan = assetUsePlan(coordinator.projectFile(), asset, resource, {
      at: 1,
      pop: true,
      anchor: "bottomRight",
    });
  const result = coordinator.apply({ label: "Use picture", commands: plan.commands });
  expect(result.revision).toBe(1);
  const placed = coordinator.getSnapshot().project.videoTracks[0]!.clips[0]!;
  expect(placed.start.seconds).toBe(1);
  expect(placed.duration.seconds).toBe(2);
  expect(placed.keyframes["video.transform.scale"]).toHaveLength(6);
  expect(assetUses(coordinator.getSnapshot().project)[0]?.mediaID).toBe("m");
  coordinator.undo();
  expect(coordinator.getSnapshot().project.media).toHaveLength(0);
  expect(coordinator.getSnapshot().project.videoTracks[0]?.clips).toHaveLength(0);
});
it("reuses media, preserves no-op provenance order and supports overwrite and insert atomically", () => {
  const coordinator = new ProjectCoordinator(file());
  coordinator.apply({
    commands: assetUsePlan(coordinator.projectFile(), asset, resource, { at: 0, duration: 2 })
      .commands,
  });
  expect(assetUsePlan(coordinator.projectFile(), asset, resource).commands).toEqual([]);
  const before = coordinator.projectFile();
  expect(() =>
    coordinator.apply({ commands: assetUsePlan(before, asset, resource, { at: 1 }).commands }),
  ).toThrow("already has a clip");
  expect(coordinator.projectFile()).toEqual(before);
  coordinator.apply({
    commands: assetUsePlan(before, asset, resource, { at: 1, duration: 1, mode: "overwrite" })
      .commands,
  });
  expect(coordinator.getSnapshot().project.media).toHaveLength(1);
  coordinator.apply({
    commands: assetUsePlan(coordinator.projectFile(), asset, resource, {
      at: 1,
      duration: 1,
      mode: "insert",
    }).commands,
  });
  expect(
    coordinator.getSnapshot().project.videoTracks[0]?.clips.map((c) => c.start.seconds),
  ).toEqual([0, 1, 2]);
  const second = decodeAsset({ ...asset, providerID: "second", id: undefined });
  const project = coordinator.getSnapshot().project;
  const metadata = recordAssetUse(project, { asset: second, path: "second" });
  const again = recordAssetUse(
    { ...project, metadata },
    { asset, mediaID: "m", path: resource.path },
  );
  expect(
    JSON.parse(again["sidecut.assetUses"]!).map((u: { asset: { id: string } }) => u.asset.id),
  ).toEqual([asset.id, second.id]);
});
it("validates options and uses reference music/still defaults", () => {
  for (const request of [{ anchor: "wrong" }, { mode: "wrong" }, { duration: 0 }, { at: -1 }])
    expect(() => assetUsePlan(file(), asset, resource, request)).toThrow();
  const musicFile = decodeProjectFile({
    revision: 0,
    project: {
      audioTracks: [{ id: "music", kind: "audio", name: "Music", rippleMode: "follow" }],
      videoTracks: [],
    },
  });
  const coordinator = new ProjectCoordinator(musicFile),
    music = decodeAsset({ provider: "fixture", providerID: "song", kind: "music", duration: 4 });
  coordinator.apply({
    commands: assetUsePlan(musicFile, music, { mediaID: "song", path: "song.wav" }, { at: 0 })
      .commands,
  });
  expect(coordinator.getSnapshot().project.audioTracks[0]?.clips[0]?.audio).toMatchObject({
    gainDB: -31,
    fadeOut: 2,
  });
  const still = decodeAsset({ ...asset, kind: "image", duration: undefined }),
    p = new ProjectCoordinator(file());
  p.apply({ commands: assetUsePlan(file(), still, resource, { at: 0 }).commands });
  expect(p.getSnapshot().project.videoTracks[0]?.clips[0]?.duration.seconds).toBe(5);
});
it("uses current licence metadata for tagged and embedded assets and groups warnings", () => {
  const original = file().project,
    p = { ...original, metadata: recordAssetUse(original, { asset, mediaID: "missing" }) };
  expect(projectCredits(p).assets).toHaveLength(0);
  const tagged = {
    ...p,
    videoTracks: decodeProjectFile({
      revision: 0,
      project: {
        videoTracks: [
          {
            kind: "video",
            clips: [{ duration: 1, content: { solid: {} }, tags: [`asset:${asset.id}`] }],
          },
        ],
      },
    }).project.videoTracks,
  };
  const current = decodeAsset({
    ...asset,
    creditLine: "Current credit",
    licenceName: "Current licence",
  });
  expect(creditsText(projectCredits(tagged, [current]))).toBe("Credits\nCurrent credit");
  const unknown = decodeAsset({ ...asset, licenceClass: "unknown", creditLine: undefined });
  expect(projectCredits(tagged, [unknown]).warnings[0]).toContain("tandem-licence.json");
  const subscription = decodeAsset({
    ...asset,
    licenceClass: "subscription",
    remote: { licenceHolder: "Fixture service", licenceNotes: "Check plan" },
  });
  expect(projectCredits(tagged, [subscription]).warnings).toEqual([
    "1 asset from Fixture service. Check plan",
  ]);
});
