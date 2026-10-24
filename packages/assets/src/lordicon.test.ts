import { it, expect } from "vite-plus/test";
import { lordiconProvider } from "./stubs.ts";
import { decodeProviderQuery } from "@sidecut/contracts/providers";
it("108.12 Lordicon preserves stub status and cannot start a request", async () => {
  const p = lordiconProvider();
  expect(p.info.status.state).toBe("stub");
  expect(p.info.kinds).toEqual(["icon", "sticker"]);
  await expect(
    p.search(decodeProviderQuery({ text: "icon" }), new AbortController().signal),
  ).rejects.toMatchObject({ code: "stub" });
});
