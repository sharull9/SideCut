import { describe, expect, it } from "vite-plus/test";
import { mediaKind, fingerprintFile, mediaIdentity } from "./media";

describe("local media classification", () => {
  it("uses MIME types and file extensions without treating arbitrary files as media", () => {
    expect(mediaKind("Clip.MOV", "")).toBe("video");
    expect(mediaKind("recording", "audio/wav")).toBe("audio");
    expect(mediaKind("图像.png", "")).toBe("image");
    expect(mediaKind("script.txt", "text/plain")).toBeNull();
  });
  it("matches Tandem's sampled SHA-256 fingerprint encoding and ignores mtime for content identity", async () => {
    const file = new File(["abc"], "test.wav", { lastModified: 1234 });
    expect(await fingerprintFile(file)).toBe(
      "3-1234-ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(mediaIdentity("test.wav", "3-1234-hash")).toBe(mediaIdentity("test.wav", "3-9999-hash"));
    expect(mediaIdentity("test.wav", "3-1234-hash")).not.toBe(
      mediaIdentity("other.wav", "3-1234-hash"),
    );
  });
});
