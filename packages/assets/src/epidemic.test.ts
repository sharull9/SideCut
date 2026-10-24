import { it, expect } from "vite-plus/test";
import { epidemicProvider } from "./stubs.ts";
import { decodeProviderQuery } from "@sidecut/contracts/providers";
it("108.11 Epidemic preserves stub status and cannot start a request", async () => {
  const p = epidemicProvider();
  expect(p.info.status.state).toBe("stub");
  expect(p.info.capabilities.similar).toBe(true);
  await expect(
    p.search(decodeProviderQuery({ text: "music" }), new AbortController().signal),
  ).rejects.toMatchObject({ code: "stub" });
});
