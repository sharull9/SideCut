import { describe, expect, it } from "vite-plus/test";
import { decodeProjectFile, encodeProjectFile } from "@sidecut/contracts/project";
import type { ReviewThread, ReviewVersion } from "@sidecut/contracts/review";
import empty from "../../../../../tests/fixtures/tandem/empty.json";
import { reviewFeedbackCSV, reviewMarker } from "./review-feedback";

const project = decodeProjectFile(empty);
const version: ReviewVersion = {
  id: "v",
  projectID: project.project.id,
  sourceRevision: project.revision,
  createdAt: "2026-01-01",
  createdBy: "Alice",
  title: "Cut",
  source: { startSeconds: 5, durationSeconds: 10, snapshotJSON: encodeProjectFile(project) },
  artifact: { fileID: "f", name: "cut.webm", type: "video/webm", bytes: 1 },
};
const frame = 1001 / 30000;
const thread: ReviewThread = {
  id: "t",
  versionID: "v",
  anchor: {
    versionStartSeconds: frame * 3,
    sourceStartSeconds: 5 + frame * 3,
    durationSeconds: frame * 2,
  },
  author: "Bob",
  body: "Hello",
  createdAt: "today",
  replies: [],
  resolvedAt: null,
  resolvedBy: null,
  revision: 0,
};

describe("review feedback handoff", () => {
  it("maps fractional frames from a nonzero rendered range and guards the revision", () => {
    const batch = reviewMarker(version, thread, project);
    expect(batch.expectedRevision).toBe(project.revision);
    expect(batch.commands[0]?.addMarker.marker.time).toBeCloseTo(5 + frame * 3, 12);
    expect(batch.commands[0]?.addMarker.marker.duration).toBeCloseTo(frame * 2, 12);
  });
  it("accepts equivalent project envelopes with a different property order", () => {
    expect(() =>
      reviewMarker(version, thread, { project: project.project, revision: project.revision }),
    ).not.toThrow();
  });
  it("accepts an unchanged project when the exported envelope retains host journal metadata", () => {
    const source = JSON.parse(version.source.snapshotJSON);
    source.sidecutJournal = { entries: [] };
    expect(() =>
      reviewMarker(
        { ...version, source: { ...version.source, snapshotJSON: JSON.stringify(source) } },
        thread,
        project,
      ),
    ).not.toThrow();
  });
  it("rejects stale, wrong-project, changed snapshot and inconsistent time mapping", () => {
    expect(() =>
      reviewMarker(version, thread, { ...project, revision: project.revision + 1 }),
    ).toThrow();
    expect(() =>
      reviewMarker(version, thread, { ...project, project: { ...project.project, id: "other" } }),
    ).toThrow();
    expect(() =>
      reviewMarker(version, thread, {
        ...project,
        project: { ...project.project, name: "changed" },
      }),
    ).toThrow();
    expect(() =>
      reviewMarker(
        version,
        { ...thread, anchor: { ...thread.anchor, sourceStartSeconds: 8 } },
        project,
      ),
    ).toThrow();
  });
  it("quotes unicode, newlines, quotes and spreadsheet formulas in threads and replies", () => {
    const csv = reviewFeedbackCSV(version, [
      {
        ...thread,
        author: "=Alice",
        body: 'é, "hello"\nworld',
        replies: [{ id: "r", author: "\t+Bob", body: "  @formula", createdAt: "today" }],
      },
    ]);
    expect(csv).toContain('"\'=Alice"');
    expect(csv).toContain('"é, ""hello""\nworld"');
    expect(csv).toContain('"\'\t+Bob"');
    expect(csv).toContain('"\'  @formula"');
    expect(csv).toContain('"reply","r"');
    expect(csv).toContain('"source_revision"');
  });
});
