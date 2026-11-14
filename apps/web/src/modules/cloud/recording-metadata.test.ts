import { expect, it } from "vite-plus/test";
import { recordingMetadata, recordingSnapshot } from "./recording-metadata";

it("round-trips recording file details and falls back for other versions", () => {
  expect(recordingMetadata(recordingSnapshot("take.webm", "video/webm"), "Take")).toEqual({
    fileName: "take.webm",
    type: "video/webm",
  });
  expect(recordingMetadata('{"revision":1}', "Render")).toEqual({
    fileName: "Render",
    type: "video/mp4",
  });
  expect(recordingMetadata("not json", "Render").fileName).toBe("Render");
});
