import { expect, it } from "vite-plus/test";
import { decodeAsset } from "@sidecut/contracts/assets";
import type { LibraryEntry } from "@sidecut/platform-browser/asset-library";
import { BrowserAssetProviders } from "@sidecut/platform-browser/asset-providers";
import { libraryAssetDetails, generationServiceRequest } from "./service-assets";
import { serviceRequest } from "@sidecut/core/service-requests";
import { starterAssets } from "@sidecut/platform-browser/starter";
import contract from "../../../../../tests/fixtures/tandem/asset-actions.json";

it("matches the pinned starter metadata counts without downloading files", () => {
  const assets = starterAssets(),
    counts: Record<string, number> = {};
  for (const a of assets) counts[a.kind] = (counts[a.kind] ?? 0) + 1;
  expect(counts).toEqual(contract.starter.counts);
  expect(assets).toHaveLength(contract.starter.total);
  expect(new Set(assets.map((a) => a.id)).size).toBe(contract.starter.total);
  expect(assets.every((a) => a.state === "remote" && a.tags.includes("starter"))).toBe(true);
});

it("shows stored licence, files and generation provenance without fetching", async () => {
  const entry = {
    asset: decodeAsset({
      provider: "elevenlabs",
      providerID: "sfx_fixture",
      kind: "sfx",
      remote: { prompt: "Click", model: "fixture" },
    }),
    original: new File(["audio"], "original.wav"),
    licence: new File(
      [JSON.stringify({ name: "Fixture terms", licenceClass: "aiGenerated" })],
      "licence.json",
    ),
  };
  expect(await libraryAssetDetails(entry)).toMatchObject({
    original: "original.wav",
    licence: { name: "Fixture terms" },
    prompt: "Click",
    model: "fixture",
  });
  expect((await libraryAssetDetails(entry)).file).toBeUndefined();
});
it("validates generation defaults and aliases before a provider call", () => {
  expect(
    generationServiceRequest(
      serviceRequest("assets-generate", {
        kind: "sounds",
        prompt: "  click ",
        duration: "0:01",
        variations: 99,
      }),
    ),
  ).toMatchObject({
    kind: "sfx",
    prompt: "click",
    duration: 1,
    variations: 4,
    loop: false,
    instrumental: true,
  });
  expect(
    generationServiceRequest({ kind: "music", prompt: "Song", variations: -1, vocals: true }),
  ).toMatchObject({ variations: 1, instrumental: false });
  for (const request of [
    { kind: "image", prompt: "no" },
    { kind: "music", prompt: "no", duration: 2 },
    { kind: "sfx", prompt: " " },
    { kind: "sfx", prompt: "no", duration: 31 },
  ])
    expect(() => generationServiceRequest(request)).toThrow();
  expect(() => serviceRequest("assets-generate", { prompt: "no kind" })).toThrow(
    "kind is required",
  );
});
it("keeps generated originals and reports normalization/provider failures without losing the first take", async () => {
  const rows = new Map<string, LibraryEntry>();
  let calls = 0;
  const library = {
      entries: async () => [...rows.values()],
      get: async (id: string) => rows.get(id),
      put: async (entry: LibraryEntry) => {
        rows.set(entry.asset.id, entry);
      },
    },
    providers = new BrowserAssetProviders(library, {
      mode: "host",
      hasCredential: async () => true,
      request: async () => {
        calls++;
        return { status: calls === 1 ? 200 : 500, headers: {}, bytes: new ArrayBuffer(3) };
      },
    });
  await expect(
    providers.generate({ kind: "sfx", prompt: "Click" }, false, new AbortController().signal),
  ).rejects.toThrow("Confirm");
  expect(calls).toBe(0);
  const result = await providers.generate(
    { kind: "sfx", prompt: "Click", duration: 0.5, variations: 2, loop: true },
    true,
    new AbortController().signal,
  );
  expect(calls).toBe(2);
  expect(result.entries).toHaveLength(1);
  expect(result.entries[0]?.asset.state).toBe("original");
  expect(result.entries[0]?.original?.size).toBe(3);
  expect(result.failures).toHaveLength(2);
  expect(result.failures.some((f) => f.includes("could not be normalized"))).toBe(true);
  expect((await library.get(result.entries[0]!.asset.id))?.asset.remote.prompt).toBe("Click");
});
