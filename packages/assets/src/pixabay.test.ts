import { describe, it, expect } from "vite-plus/test";
import images from "../../../tests/fixtures/tandem/providers/pixabay_images.json";
import videos from "../../../tests/fixtures/tandem/providers/pixabay_videos.json";
import { mockEnvironment } from "./test-support.ts";
import { pixabayProvider } from "./pixabay.ts";
import { decodeProviderQuery } from "@sidecut/contracts/providers";
describe("108.03 Pixabay", () => {
  it("matches pinned IDs, renditions, attribution and request flags", async () => {
    const { env, requests } = mockEnvironment(images),
      p = pixabayProvider(env),
      signal = new AbortController().signal;
    const rows = await p.search(
      decodeProviderQuery({ text: "flower", kinds: ["image"], perPage: 1 }),
      signal,
    );
    expect(rows[0]).toMatchObject({
      id: "pixabay:image-195893",
      creditLine: "Image by Josch13 from Pixabay",
      width: 4000,
    });
    expect(requests[0]!.url).toContain("per_page=3");
    expect(requests[0]!.auth).toBe(true);
    env.request = async () => ({
      status: 200,
      headers: {},
      bytes: new TextEncoder().encode(JSON.stringify(videos)).buffer,
    });
    const result = await p.search(
      decodeProviderQuery({ text: "flowers", kinds: ["video"] }),
      signal,
    );
    expect(result[0]!.remote.download).toContain("medium.mp4");
  });
  it("rejects missing setup without making a request", async () => {
    const { env, requests } = mockEnvironment();
    env.hasCredential = async () => false;
    await expect(
      pixabayProvider(env).search(
        decodeProviderQuery({ text: "flower" }),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "needsKey" });
    expect(requests).toEqual([]);
  });
});
