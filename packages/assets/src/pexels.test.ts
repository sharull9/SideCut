import { describe, it, expect } from "vite-plus/test";
import photos from "../../../tests/fixtures/tandem/providers/pexels_photos.json";
import videos from "../../../tests/fixtures/tandem/providers/pexels_videos.json";
import { mockEnvironment } from "./test-support.ts";
import { pexelsProvider } from "./pexels.ts";
import { decodeProviderQuery } from "@sidecut/contracts/providers";
describe("108.04 Pexels", () => {
  it("matches pinned photo/video identities and optional attribution", async () => {
    const { env, requests } = mockEnvironment(photos),
      signal = new AbortController().signal;
    const rows = await pexelsProvider(env).search(
      decodeProviderQuery({ text: "programming", kinds: ["image"] }),
      signal,
    );
    expect(rows[0]).toMatchObject({
      id: "pexels:photo-1181675",
      creditLine: "Photo by Christina Morillo on Pexels",
      licenceClass: "noCredit",
    });
    expect(requests[0]!.auth).toBe(true);
    const video = await pexelsProvider(mockEnvironment(videos).env).search(
      decodeProviderQuery({ text: "city", kinds: ["video"] }),
      signal,
    );
    expect(video[0]!.kind).toBe("video");
    expect(video[0]!.remote.download).toBeTruthy();
  });
  it("reports permission failure without exposing response bodies", async () => {
    const { env } = mockEnvironment();
    env.request = async () => ({
      status: 401,
      headers: {},
      bytes: new TextEncoder().encode("do not echo this credential").buffer,
    });
    await expect(
      pexelsProvider(env).search(
        decodeProviderQuery({ text: "city" }),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      code: "permission",
      message: "Pexels request failed (401). Check provider setup and retry.",
    });
  });
});
