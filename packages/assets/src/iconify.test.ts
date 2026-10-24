import { describe, it, expect } from "vite-plus/test";
import data from "../../../tests/fixtures/tandem/providers/iconify_search_home.json";
import { mockEnvironment } from "./test-support.ts";
import { iconifyProvider } from "./iconify.ts";
import { decodeProviderQuery } from "@sidecut/contracts/providers";
describe("108.06 Iconify", () => {
  it("matches pinned licence filtering, credit and pagination", async () => {
    const { env, requests } = mockEnvironment(data, "browser");
    const rows = await iconifyProvider(env).search(
      decodeProviderQuery({ text: "home", perPage: 1, page: 2 }),
      new AbortController().signal,
    );
    expect(rows.map((a) => a.id)).toEqual(["iconify:mdi:home", "iconify:tabler:home"]);
    expect(rows[0]!.licenceClass).toBe("noCredit");
    expect(new URL(requests[0]!.url).searchParams.get("start")).toBe("32");
  });
  it("rejects malformed response lists", async () => {
    const { env } = mockEnvironment({ icons: "bad" });
    await expect(
      iconifyProvider(env).search(
        decodeProviderQuery({ text: "home" }),
        new AbortController().signal,
      ),
    ).rejects.toThrow("list");
  });
});
