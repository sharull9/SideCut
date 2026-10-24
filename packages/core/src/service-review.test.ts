import { describe, it, expect } from "vite-plus/test";
import { decodeProjectFile } from "@sidecut/contracts/project";
import { reviewQuery } from "./service-review";
import { serviceRequest } from "./service-requests";
import fixture from "../../../tests/fixtures/tandem/review-library.json";

describe("review and library baseline contracts", () => {
  it("pins all twenty operations and rejects unknown fields", () => {
    expect(fixture.operations).toHaveLength(20);
    for (const item of fixture.operations) {
      expect(serviceRequest(item.operation, item.request)).toBeDefined();
      expect(() => serviceRequest(item.operation, { ...item.request, unknownField: true })).toThrow(
        "Unknown",
      );
    }
  });
  it("finds subframe gaps/clips and returns active comment context", () => {
    const file = decodeProjectFile(fixture.project);
    expect(reviewQuery(file, "check", { quick: true })).toMatchObject({
      frames: 0,
      notes: [
        { kind: "sliverGap", clipID: "tiny" },
        { kind: "sliverClip", clipID: "tiny" },
      ],
    });
    expect(reviewQuery(file, "comments", {})).toMatchObject({
      comments: [{ id: "review-comment", clips: [{ clipID: "first" }] }],
    });
    expect(reviewQuery(file, "check", { quick: true, from: 0, to: 0.5 })).toMatchObject({
      notes: [],
    });
    expect(() => reviewQuery(file, "check", { quick: true, changed: true })).toThrow(
      "reviewed-range",
    );
  });
});
