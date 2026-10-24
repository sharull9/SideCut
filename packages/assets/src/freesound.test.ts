import { describe, it, expect } from "vite-plus/test";
import data from "../../../tests/fixtures/tandem/providers/freesound_search.json";
import { mockEnvironment } from "./test-support.ts";
import { freesoundProvider } from "./freesound.ts";
import { decodeProviderQuery } from "@sidecut/contracts/providers";
describe("108.05 Freesound", () => {
  it("keeps CC0/BY results and filters noncommercial recordings", async () => {
    const { env, requests } = mockEnvironment(data);
    env.enabled = () => true;
    const rows = await freesoundProvider(env).search(
      decodeProviderQuery({ text: "whoosh", maxDuration: 3 }),
      new AbortController().signal,
    );
    expect(rows.map((a) => a.id)).toEqual(["freesound:60013", "freesound:346373"]);
    expect(rows[1]!.creditLine).toContain("denao270");
    expect(rows[1]!.remote.quality).toBe("hq-preview");
    expect(new URL(requests[0]!.url).searchParams.get("filter")).toContain("duration:[* TO 3]");
  });
  it("is disabled before an explicit operator enablement", async () => {
    const { env, requests } = mockEnvironment(data);
    await expect(
      freesoundProvider(env).search(
        decodeProviderQuery({ text: "whoosh" }),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "disabled" });
    expect(requests).toHaveLength(0);
  });
});
