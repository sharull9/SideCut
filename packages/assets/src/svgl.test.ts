import { describe, it, expect } from "vite-plus/test";
import data from "../../../tests/fixtures/tandem/providers/svgl.json";
import { mockEnvironment } from "./test-support.ts";
import { svglProvider } from "./svgl.ts";
import { decodeProviderQuery } from "@sidecut/contracts/providers";
describe("108.07 SVGL", () => {
  it("expands theme and wordmark variants without duplicating files", async () => {
    const { env } = mockEnvironment(data, "browser");
    const rows = await svglProvider(env).search(
      decodeProviderQuery({}),
      new AbortController().signal,
    );
    expect(rows.length).toBeGreaterThan(2);
    expect(new Set(rows.map((a) => a.id)).size).toBe(rows.length);
    expect(rows.some((a) => a.name.includes("dark"))).toBe(true);
    expect(
      rows.every((a) => a.licenceClass === "noCredit" && a.summary?.includes("trademark")),
    ).toBe(true);
  });
  it("rejects invalid catalogue input", async () => {
    await expect(
      svglProvider(mockEnvironment({ bad: true }).env).search(
        decodeProviderQuery({}),
        new AbortController().signal,
      ),
    ).rejects.toThrow("list");
  });
});
