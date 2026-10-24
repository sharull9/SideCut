import { describe, it, expect } from "vite-plus/test";
import data from "../../../tests/fixtures/tandem/providers/noto_api.json";
import { mockEnvironment } from "./test-support.ts";
import { notoProvider, notoAsset, NOTO_CREDIT } from "./noto.ts";
import { decodeProviderQuery } from "@sidecut/contracts/providers";
describe("108.08 Noto", () => {
  it("preserves reference codepoints and mandatory credit", async () => {
    const { env } = mockEnvironment(data, "browser");
    const rows = await notoProvider(env).search(
      decodeProviderQuery({}),
      new AbortController().signal,
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(
      rows.every(
        (a) =>
          a.id === `noto:${a.providerID}` &&
          a.creditLine === NOTO_CREDIT &&
          a.licenceClass === "creditNeeded",
      ),
    ).toBe(true);
    expect(notoAsset("1f680").remote.webp).toContain("1f680/512.webp");
  });
  it("keeps the fetched animated WebP when Lottie download fails", async () => {
    const { env } = mockEnvironment();
    env.request = async (r) => ({
      status: r.url.endsWith(".json") ? 404 : 200,
      headers: {},
      bytes: new ArrayBuffer(4),
    });
    const result = await notoProvider(env).fetch(notoAsset("1f680"), new AbortController().signal);
    expect(result.files.map((f) => f.name)).toEqual(["original-512.webp"]);
    expect(() => notoAsset("../x")).toThrow();
  });
});
