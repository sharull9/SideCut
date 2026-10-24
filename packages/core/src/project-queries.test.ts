import { describe, expect, it } from "vite-plus/test";
import { decodeProjectFile } from "@sidecut/contracts/project";
import fixture from "../../../tests/fixtures/tandem/project-queries.json";
import { queryClips, queryTimeline, queryRequest } from "./project-queries";

describe("pinned project query contracts", () => {
  const file = decodeProjectFile(fixture.project);
  it("matches clip listings and rejects unknown tracks without changing the source", () => {
    expect(queryClips(file, fixture.clips.request)).toEqual(fixture.clips.result);
    expect(() => queryClips(file, fixture.clips.failure)).toThrow(/no track/);
    expect(queryClips(file, { from: 5 }).clips).toEqual([]);
    expect(queryClips(file, {}).clips).toHaveLength(1);
    expect(() => queryClips(file, { media: "absent.mov" })).toThrow(/No media/);
  });
  it("filters full clips at half-open boundaries and validates all fields", () => {
    const result = queryTimeline(file, fixture.timeline.request);
    expect(result.project.videoTracks[0].clips.map((c: { id: string }) => c.id)).toEqual(
      fixture.timeline.clipIDs,
    );
    expect(file.project.videoTracks[0]!.clips).toHaveLength(1);
    expect(() => queryTimeline(file, fixture.timeline.failure)).toThrow(/after/);
    expect(() => queryRequest("media", fixture.media.failure)).toThrow(/refresh/);
    expect(() => queryRequest("status", fixture.status.failure)).toThrow(/Unknown/);
    expect(queryTimeline(file, { summary: true }).text).toContain(
      "1 tracks, 1 clips, 1 media files",
    );
    expect(queryTimeline(file, { from: "00:02.500", to: 3 }).text).toContain("clip_query");
  });
});
