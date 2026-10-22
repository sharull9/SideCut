import { describe, expect, it } from "vite-plus/test";
import { decodeProjectFile, encodeProjectFile, inspectProjectFile } from "./project";

describe("legacy migration and read-only imports", () => {
  it("drops schema-one text defaults once and preserves explicit overrides and future fields", () => {
    const raw = {
      revision: 7,
      future: { keep: true },
      project: {
        id: "old",
        schemaVersion: 1,
        videoTracks: [
          {
            id: "titles",
            kind: "video",
            clips: [
              {
                id: "title",
                duration: 2,
                content: {
                  text: {
                    text: "hello",
                    animationDuration: 0.4,
                    style: {
                      font: "SF Pro Display",
                      size: 64,
                      weight: 800,
                      color: { r: 1, g: 1, b: 1, a: 1 },
                      strokeWidth: 0,
                      alignment: "center",
                      uppercase: false,
                      shadow: false,
                      lineSpacing: 0,
                      strokeColor: { r: 1 },
                      backgroundColor: { b: 1 },
                      future: "kept",
                    },
                  },
                },
              },
            ],
          },
        ],
      },
    };
    const file = decodeProjectFile(raw);
    expect(file.project.schemaVersion).toBe(2);
    expect(file.project.videoTracks[0]?.clips[0]?.content.text).toEqual({
      text: "hello",
      style: { strokeColor: { r: 1 }, backgroundColor: { b: 1 }, future: "kept" },
    });
    expect(decodeProjectFile(JSON.parse(encodeProjectFile(file)))).toEqual(file);
    const explicit = decodeProjectFile({ ...raw, project: { ...raw.project, schemaVersion: 2 } });
    expect(
      (explicit.project.videoTracks[0]!.clips[0]!.content.text as { style: { uppercase: boolean } })
        .style.uppercase,
    ).toBe(false);
  });
  it("preserves unsupported schemas and content exactly for read-only downloading", () => {
    for (const raw of [
      { revision: 9, project: { schemaVersion: 99, arbitrary: [1, { x: true }] } },
      {
        revision: 9,
        project: {
          videoTracks: [
            { kind: "video", clips: [{ duration: 1, content: { future: { x: true } } }] },
          ],
        },
      },
    ]) {
      const result = inspectProjectFile(raw);
      expect(result.editable).toBe(false);
      if (!result.editable) expect(JSON.parse(result.raw)).toEqual(raw);
      expect(() => decodeProjectFile(raw)).toThrow();
    }
    expect(() => inspectProjectFile({ accidental: "not a project" })).toThrow(/envelope/);
  });
});
