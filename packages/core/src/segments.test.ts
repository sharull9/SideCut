import { describe, it, expect } from "vite-plus/test";
import { decodeProjectFile, encodeProjectFile } from "@sidecut/contracts/project";
import { makeSegment, decodeSegment, insertableSegment, segmentSummary } from "./segments";
import { ProjectCoordinator } from "./coordinator";
import { projectCredits } from "./asset-use";
import contract from "../../../tests/fixtures/tandem/segments-cli-foundation.json";
const source = () =>
  decodeProjectFile({
    revision: 0,
    project: {
      name: "Source",
      media: [
        {
          id: "m",
          kind: "image",
          path: "logo.png",
          asset: {
            provider: "local",
            providerID: "logo",
            kind: "logo",
            licenceClass: "creditNeeded",
            creditLine: "Logo maker",
          },
        },
      ],
      videoTracks: [
        {
          id: "v",
          kind: "video",
          name: "Graphics",
          clips: [
            {
              id: "a",
              content: { media: { mediaID: "m" } },
              start: 4,
              duration: 1,
              linkGroup: "pair",
            },
            {
              id: "b",
              content: { media: { mediaID: "m" } },
              start: 5,
              duration: 1,
              linkGroup: "pair",
            },
          ],
          transitions: [
            { id: "d", type: "dissolve", duration: 0.2, fromClipID: "a", toClipID: "b" },
          ],
        },
      ],
    },
  }).project;
describe("saved segments", () => {
  it("carries selected clips, media, transitions and credits into another project with fresh IDs", () => {
    const segment = decodeSegment(
      JSON.parse(JSON.stringify(makeSegment(source(), ["a", "b"], "Intro", "2026-10-24"))),
    );
    expect(segment.template.clips).toHaveLength(2);
    expect(segment.resources).toContainEqual({ key: "m", path: "media/0-logo.png" });
    expect(segment.resources).toContainEqual({
      key: "asset-licence:local:logo",
      path: "licences/1.json",
      optional: true,
    });
    const target = new ProjectCoordinator(
      decodeProjectFile({
        revision: 0,
        project: { id: "target", markers: [{ id: "m", time: 0 }] },
      }),
    );
    target.apply({
      commands: [
        { insertTemplate: { template: insertableSegment(segment), at: 3, mode: "place" } },
      ],
    });
    const p = target.getSnapshot().project,
      clips = p.videoTracks[0]!.clips;
    expect(clips.map((c) => c.start.seconds)).toEqual([3, 4]);
    expect(clips[0]!.id).not.toBe("a");
    expect(clips[0]!.linkGroup).toBe(clips[1]!.linkGroup);
    expect(clips[0]!.linkGroup).not.toBe("pair");
    expect(p.media[0]!.id).not.toBe("m");
    expect(p.videoTracks[0]!.transitions[0]).toMatchObject({
      fromClipID: clips[0]!.id,
      toClipID: clips[1]!.id,
    });
    expect(projectCredits(p).entries[0]!.line).toBe("Logo maker");
    target.undo();
    expect(target.getSnapshot().project.media).toEqual([]);
  });
  it("rejects overlapping inserts atomically and validates stored resource paths", () => {
    const s = makeSegment(source(), ["a", "b"], "Intro"),
      c = new ProjectCoordinator(decodeProjectFile({ revision: 0, project: {} })),
      batch = {
        commands: [{ insertTemplate: { template: insertableSegment(s), at: 0, mode: "place" } }],
      };
    c.apply(batch);
    const before = encodeProjectFile(c.projectFile());
    expect(() => c.apply(batch)).toThrow();
    expect(encodeProjectFile(c.projectFile())).toBe(before);
    expect(() => decodeSegment({ ...s, version: 2 })).toThrow("Unsupported");
    expect(() =>
      decodeSegment({
        ...JSON.parse(JSON.stringify(s)),
        resources: [{ key: "m", path: "../secret" }],
      }),
    ).toThrow("relative");
  });
});

it("pins exact selection, mixed unknown IDs, omitted transitions and read-only summaries", () => {
  const p = source(),
    before = JSON.stringify(p);
  const s = makeSegment(p, contract.segments.exactSelection, "  Intro / A  ");
  expect(s.template.clips.map((c) => c.clip.id)).toEqual(["a"]);
  expect(s.template.clips[0]!.clip.linkGroup).toBeUndefined();
  expect(s.notes).toEqual([contract.segments.halfTransitionNote]);
  expect(s.template.transitions).toEqual([]);
  expect(s.name).toBe("Intro / A");
  expect(s.id).toBe("Intro - A");
  expect(Object.keys(segmentSummary(s, [])).sort()).toEqual(
    [...contract.segments.summaryKeys].sort(),
  );
  expect(segmentSummary(s, []).missing).toEqual(["media/0-logo.png"]);
  expect(() => makeSegment(p, ["a", "unknown"], "Invalid")).toThrow();
  expect(JSON.stringify(p)).toBe(before);
});
it("pins title fields, defaults, overrides, fresh media IDs and replacement resource isolation", () => {
  const p = decodeProjectFile({
    revision: 0,
    project: {
      videoTracks: [
        {
          id: "t",
          kind: "video",
          name: "Text",
          clips: [{ id: "title", start: 2, duration: 1, content: { text: { text: "Original" } } }],
        },
      ],
    },
  }).project;
  const s = makeSegment(p, ["title"], "Title", "first", [
    { clipID: "title", label: "Section title" },
  ]);
  expect(s.template.fields).toEqual([contract.segments.field]);
  const target = new ProjectCoordinator(decodeProjectFile({ revision: 0, project: {} }));
  const result = target.apply({
    commands: [
      {
        insertTemplate: {
          template: insertableSegment(s),
          at: 0,
          values: { sectionTitle: "Override" },
        },
      },
    ],
  });
  expect(result.revision).toBe(contract.segments.insertRevisionDelta);
  expect(target.getSnapshot().project.videoTracks[0]!.clips[0]!.content.text).toMatchObject({
    text: "Override",
  });
  target.undo();
  expect(target.getSnapshot().project.videoTracks).toEqual([]);
  expect(() => makeSegment(p, ["title"], "Invalid", "", [{ clipID: "missing" }])).toThrow();
  expect(() => makeSegment(source(), ["a"], "Invalid", "", [{ clipID: "a" }])).toThrow("title");
  const first = makeSegment(source(), ["a"], "Same", "first"),
    second = makeSegment(source(), ["a"], "Same", "second");
  expect(JSON.stringify(insertableSegment(first))).not.toBe(
    JSON.stringify(insertableSegment(second)),
  );
  expect(first.template.clips[0]!.media!.id).toBe("");
});
