import { it, expect } from "vite-plus/test";
import { transcriptionLanguage, transcriptVersion } from "./transcription-config";
it("normalizes supported locales and isolates multilingual caches", () => {
  expect(transcriptionLanguage("ta-IN")).toBe("ta");
  expect(transcriptionLanguage("pt_BR")).toBe("pt");
  expect(transcriptVersion("hi-IN")).not.toBe(transcriptVersion("en"));
  expect(() => transcriptionLanguage("made-up")).toThrow(/Unsupported/);
});
