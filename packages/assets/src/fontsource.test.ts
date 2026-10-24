import { describe, it, expect } from "vite-plus/test";
import families from "../../../tests/fixtures/tandem/providers/fontsource_fonts.json";
import detail from "../../../tests/fixtures/tandem/providers/fontsource_inter.json";
import { mockEnvironment } from "./test-support.ts";
import { fontsourceProvider } from "./fontsource.ts";
import { decodeProviderQuery } from "@sidecut/contracts/providers";
describe("108.09 Fontsource", () => {
  it("maps families and fetches regular font first while retaining other variants", async () => {
    const { env } = mockEnvironment(families, "browser"),
      signal = new AbortController().signal;
    const rows = await fontsourceProvider(env).search(
      decodeProviderQuery({ text: "inter" }),
      signal,
    );
    expect(rows[0]).toMatchObject({ id: "fontsource:inter", kind: "font" });
    env.request = async (r) => ({
      status: 200,
      headers: {},
      bytes: r.url.includes("api.fontsource.org")
        ? new TextEncoder().encode(JSON.stringify(detail)).buffer
        : new ArrayBuffer(8),
    });
    const fetched = await fontsourceProvider(env).fetch(rows[0]!, signal);
    expect(fetched.files[0]!.name).toContain("400-normal");
    expect(fetched.files.length).toBeGreaterThan(1);
  });
  it("rejects an incomplete family detail", async () => {
    const { env } = mockEnvironment({ variants: {} });
    const asset = (
      await fontsourceProvider(mockEnvironment(families).env).search(
        decodeProviderQuery({ text: "inter" }),
        new AbortController().signal,
      )
    )[0]!;
    await expect(
      fontsourceProvider(env).fetch(asset, new AbortController().signal),
    ).rejects.toThrow("no usable");
  });
});
