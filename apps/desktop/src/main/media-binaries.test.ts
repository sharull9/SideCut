import { expect, it } from "vite-plus/test";
import { access } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { mediaBinaries } from "./media-binaries.ts";

it("resolves installed native binaries without PATH and retains host overrides", async () => {
  const binaries = mediaBinaries({});
  expect(isAbsolute(binaries.ffmpeg)).toBe(true);
  expect(isAbsolute(binaries.ffprobe)).toBe(true);
  await Promise.all([access(binaries.ffmpeg), access(binaries.ffprobe)]);
  expect(
    mediaBinaries({ SIDECUT_FFMPEG: "/custom/ffmpeg", SIDECUT_FFPROBE: "/custom/ffprobe" }),
  ).toEqual({ ffmpeg: "/custom/ffmpeg", ffprobe: "/custom/ffprobe" });
});

it("resolves packaged executables outside ASAR and honors overrides", () => {
  const suffix = process.platform === "win32" ? ".exe" : "";
  expect(mediaBinaries({}, "/resources")).toEqual({
    ffmpeg: join("/resources", "media", `ffmpeg${suffix}`),
    ffprobe: join("/resources", "media", `ffprobe${suffix}`),
  });
  expect(mediaBinaries({ SIDECUT_FFMPEG: "/custom/ffmpeg" }, "/resources").ffmpeg).toBe(
    "/custom/ffmpeg",
  );
});
