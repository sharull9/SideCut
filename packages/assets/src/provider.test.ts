import { describe, it, expect } from "vite-plus/test";
import { ProviderHTTP, providerInfo } from "./provider.ts";
import { mockEnvironment } from "./test-support.ts";
import { decodeProviderQuery, decodeGeneration } from "@sidecut/contracts/providers";
import { decodeAsset } from "@sidecut/contracts/assets";
import { localProvider } from "./local.ts";
import { authenticatedRequest } from "./transport.ts";
import { AssetProviders } from "./index.ts";
const signal = () => new AbortController().signal;
describe("provider boundary", () => {
  it("validates query and generation defaults before any request", () => {
    expect(decodeProviderQuery({})).toMatchObject({ text: "", page: 1, perPage: 30 });
    expect(() => decodeProviderQuery({ page: 0 })).toThrow();
    expect(() => decodeGeneration({ prompt: "x", duration: 40 })).toThrow();
    expect(decodeGeneration({ prompt: " x ", variations: 10 })).toMatchObject({
      prompt: "x",
      variations: 4,
      kind: "sfx",
      instrumental: true,
    });
  });
  it("distinguishes unsupported browser, missing setup, disabled and request failures", async () => {
    const { env } = mockEnvironment();
    const info = providerInfo("pixabay", "Pixabay", ["image"]);
    expect((await new ProviderHTTP({ ...env, mode: "browser" }, info).status()).state).toBe(
      "unsupported",
    );
    expect(
      (await new ProviderHTTP({ ...env, hasCredential: async () => false }, info).status()).state,
    ).toBe("needsKey");
    expect(
      (await new ProviderHTTP(env, providerInfo("freesound", "Freesound", ["sfx"])).status()).state,
    ).toBe("disabled");
    const bad = new ProviderHTTP(
      { ...env, request: async () => ({ status: 500, headers: {}, bytes: new ArrayBuffer(0) }) },
      info,
    );
    await expect(bad.json("https://example.com", signal())).rejects.toMatchObject({
      code: "request",
    });
  });
  it("caches public URLs for the provider TTL and honours cancellation", async () => {
    const { env, requests } = mockEnvironment({ ok: true });
    const http = new ProviderHTTP(env, providerInfo("pixabay", "Pixabay", ["image"]));
    await http.json("https://pixabay.com/api/?q=test", signal(), true);
    await http.json("https://pixabay.com/api/?q=test", signal(), true);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).not.toContain("key=");
    const c = new AbortController();
    c.abort();
    await expect(http.json("https://pixabay.com/api/?q=test", c.signal)).rejects.toThrow();
  });
  it("only injects credentials at the allowed API host", () => {
    const r = {
      provider: "pexels",
      url: "https://api.pexels.com/v1/search",
      auth: true,
      signal: signal(),
    };
    expect(authenticatedRequest(r, "test-credential").headers.Authorization).toBe(
      "test-credential",
    );
    expect(() =>
      authenticatedRequest(
        { ...r, url: "https://images.pexels.com/picture.jpg" },
        "test-credential",
      ),
    ).toThrow("Credentials");
    expect(() =>
      authenticatedRequest({ ...r, url: "http://127.0.0.1/" }, "test-credential"),
    ).toThrow("allowed");
  });
  it("requires paid confirmation before calling a generation adapter", async () => {
    const { env, requests } = mockEnvironment();
    await expect(
      new AssetProviders(env).generate(
        "elevenlabs",
        { prompt: "click" },
        false,
        signal(),
        async () => {},
      ),
    ).rejects.toThrow("Confirm");
    expect(requests).toHaveLength(0);
  });
});
describe("108.01 shared library", () => {
  it("preserves identity and filters local rows, with a missing-file failure", async () => {
    const a = decodeAsset({
      provider: "shared",
      providerID: "Icons/camera.svg",
      kind: "icon",
      creditLine: "Maker",
      licenceClass: "creditNeeded",
    });
    const { env } = mockEnvironment();
    env.localAssets = async () => [a];
    env.localFiles = async () => [
      { name: "camera.svg", type: "image/svg+xml", bytes: new ArrayBuffer(1) },
    ];
    const p = localProvider(env, "shared");
    expect(await p.search(decodeProviderQuery({ text: "camera" }), signal())).toEqual([a]);
    expect((await p.fetch(a, signal())).asset.creditLine).toBe("Maker");
    env.localFiles = async () => [];
    await expect(p.fetch(a, signal())).rejects.toThrow("missing");
  });
});
