import { expect, it } from "vite-plus/test";
import { AssetProviders } from "../../../../../packages/assets/src/index";
import { decodeAsset, type Asset } from "@sidecut/contracts/assets";
import { serviceRequest } from "@sidecut/core/service-requests";
import { searchServiceAssets } from "./service-assets";
import contract from "../../../../../tests/fixtures/tandem/resources-assets.json";

function setup() {
  const catalogue: Asset[] = [],
    external = Array.from({ length: 205 }, (_, i) =>
      decodeAsset({
        provider: "import",
        providerID: String(i),
        kind: "sfx",
        name: `Sound ${i}`,
        duration: i + 1,
      }),
    );
  let requests = 0;
  const providers = new AssetProviders({
    mode: "host",
    hasCredential: async () => false,
    localAssets: async (id) => (id === "import" ? external : []),
    request: async () => {
      requests++;
      throw new Error("Fixture offline");
    },
  });
  const library = {
    entries: async () => catalogue.map((asset) => ({ asset })),
    mergeRemote: async (assets: readonly Asset[]) => {
      for (const a of assets) if (!catalogue.some((e) => e.id === a.id)) catalogue.push(a);
    },
  };
  return { providers, library, catalogue, requests: () => requests };
}
it("lists provider capabilities and statuses without requesting files or exposing credentials", async () => {
  const { providers, requests } = setup(),
    info = await providers.list();
  expect(info).toHaveLength(12);
  expect(info.find((p) => p.id === "pixabay")).toMatchObject({
    status: { state: "needsKey" },
    capabilities: { search: true, generate: false },
  });
  expect(info.find((p) => p.id === "elevenlabs")?.capabilities.generate).toBe(true);
  expect(requests()).toBe(0);
  expect(JSON.stringify(info)).not.toContain("apiKey");
});
it("merges online results before local matching, supports aliases and clamps limits", async () => {
  const { providers, library, catalogue } = setup(),
    signal = new AbortController().signal;
  const result = await searchServiceAssets(
    library,
    providers,
    serviceRequest("assets-search", {
      provider: "import",
      kind: "sounds",
      online: true,
      limit: 999,
    }),
    signal,
  );
  expect(result.local).toHaveLength(200);
  expect(result.total).toBe(200);
  expect(catalogue).toHaveLength(200);
  const defaults = await searchServiceAssets(library, providers, {}, signal);
  expect(defaults.local).toHaveLength(contract.search.limit);
  expect(defaults.online).toBeUndefined();
  expect(
    (
      await searchServiceAssets(
        library,
        providers,
        serviceRequest("assets-search", { kinds: "sfx,music", limit: 0, maxDuration: "0:03" }),
        signal,
      )
    ).local,
  ).toHaveLength(1);
  await expect(
    searchServiceAssets(library, providers, { providers: ["unknown"] }, signal),
  ).rejects.toThrow("Unknown asset provider");
  await expect(searchServiceAssets(library, providers, { kinds: ["bad"] }, signal)).rejects.toThrow(
    "Unknown asset kind",
  );
});
it("keeps per-provider failures and honours cancellation", async () => {
  const { providers, library } = setup(),
    signal = new AbortController().signal;
  const result = await searchServiceAssets(
    library,
    providers,
    { providers: ["noto", "pixabay"], online: true },
    signal,
  );
  expect(result.online).toEqual([
    expect.objectContaining({ provider: "pixabay", assets: [], error: expect.any(String) }),
    expect.objectContaining({
      provider: "noto",
      assets: [],
      error: expect.stringContaining("could not be reached"),
    }),
  ]);
  const controller = new AbortController();
  controller.abort();
  await expect(searchServiceAssets(library, providers, {}, controller.signal)).rejects.toThrow();
});
