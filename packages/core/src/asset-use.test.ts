import { describe, it, expect } from "vite-plus/test";
import { decodeProjectFile, encodeProjectFile } from "@sidecut/contracts/project";
import { decodeAsset } from "@sidecut/contracts/assets";
import { projectCredits, recordAssetUse, creditsText, assetSuggestions } from "./asset-use";
import { ProjectCoordinator } from "./coordinator";
describe("project asset provenance", () => {
  const asset = (id: string, licenceClass = "creditNeeded", creditLine = "Credit maker") =>
    decodeAsset({ provider: "local", providerID: id, kind: "image", licenceClass, creditLine });
  it("deduplicates credit lines and upgrades courtesy credits to required", () => {
    const a = asset("a", "noCredit"),
      b = asset("b"),
      c = asset("c", "unknown", "");
    const p = decodeProjectFile({
      revision: 0,
      project: {
        media: [
          { id: "a", kind: "image", path: "a.png", asset: a },
          { id: "b", kind: "image", path: "b.png", asset: b },
          { id: "c", kind: "image", path: "c.png", asset: c },
        ],
        videoTracks: [
          {
            kind: "video",
            clips: [{ content: { solid: {} }, duration: 1, tags: ["asset:local:b"] }],
          },
        ],
      },
    }).project;
    const report = projectCredits(p);
    expect(report.entries).toHaveLength(1);
    expect(report.entries[0]).toMatchObject({ required: true, assetIDs: [a.id, b.id] });
    expect(report.assets).toHaveLength(3);
    expect(report.warnings[0]).toContain("No licence");
    expect(creditsText(report)).toBe("Credits\nCredit maker");
  });
  it("keeps installed non-media credits across save and undo without crediting removed media", () => {
    const c = new ProjectCoordinator(decodeProjectFile({ revision: 0, project: {} })),
      a = asset("font");
    c.apply({
      commands: [
        {
          updateProject: {
            patch: { metadata: recordAssetUse(c.getSnapshot().project, { asset: a }) },
          },
        },
      ],
    });
    const p = decodeProjectFile(JSON.parse(encodeProjectFile(c.projectFile()))).project;
    expect(projectCredits(p).assets[0]!.id).toBe(a.id);
    c.undo();
    expect(projectCredits(c.getSnapshot().project).assets).toEqual([]);
    const removed = { ...p, metadata: recordAssetUse(p, { asset: a, mediaID: "gone" }) };
    expect(projectCredits(removed).assets).toEqual([]);
  });
  it("reports absent mandatory lines and retains reference audio suggestions", () => {
    const a = asset("sfx", "creditNeeded", "");
    const p = decodeProjectFile({ revision: 0, project: {} }).project;
    expect(
      projectCredits({ ...p, metadata: recordAssetUse(p, { asset: a }) }).warnings[0],
    ).toContain("no credit line");
    expect(assetSuggestions("music").audio).toEqual({ gainDB: -31, fadeOut: 2 });
  });
});
