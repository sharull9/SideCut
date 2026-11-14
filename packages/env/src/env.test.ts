import { describe, expect, it } from "vite-plus/test";
import { createAuthEnv, createStorageEnv } from "./cloud";
import { createDesktopEnv } from "./desktop";
import { createLandingEnv } from "./landing";
import { createWebEnv } from "./web";

describe("browser environment", () => {
  it("allows local editing and treats blank optional values as absent", () => {
    const input = { VITE_CONVEX_URL: "", VITE_WORKOS_DEV_MODE: "" };
    const env = createWebEnv(input);
    expect(env.VITE_CONVEX_URL).toBeUndefined();
    expect(env.VITE_WORKOS_DEV_MODE).toBeUndefined();
    expect(input.VITE_CONVEX_URL).toBe("");
    expect(createLandingEnv({ VITE_EDITOR_URL: "" }).VITE_EDITOR_URL).toBeUndefined();
  });

  it("rejects malformed URLs, hostnames and boolean settings", () => {
    expect(() => createWebEnv({ VITE_CONVEX_URL: "not-a-url" })).toThrow();
    expect(() => createWebEnv({ VITE_WORKOS_API_HOSTNAME: "https://auth.example.com" })).toThrow();
    expect(() => createWebEnv({ VITE_WORKOS_DEV_MODE: "1" })).toThrow();
    expect(() => createLandingEnv({ VITE_EDITOR_URL: "javascript:alert(1)" })).toThrow();
    expect(createWebEnv({ VITE_WORKOS_DEV_MODE: "false" }).VITE_WORKOS_DEV_MODE).toBe("false");
  });

  it("does not expose server secrets supplied alongside browser settings", () => {
    const env = createWebEnv({
      VITE_CONVEX_URL: "https://example.convex.cloud",
      R2_SECRET_ACCESS_KEY: "secret",
    });
    expect(Object.keys(env)).not.toContain("R2_SECRET_ACCESS_KEY");
    expect(Reflect.get(env, "R2_SECRET_ACCESS_KEY")).toBeUndefined();
  });
});

describe("server environment", () => {
  it("requires auth independently of storage configuration", () => {
    expect(() => createAuthEnv({ WORKOS_CLIENT_ID: "" })).toThrow();
    expect(createAuthEnv({ WORKOS_CLIENT_ID: "client_test" }).WORKOS_CLIENT_ID).toBe("client_test");
  });

  it("validates complete R2 credentials without leaking values in errors", () => {
    const input = {
      R2_ACCOUNT_ID: "a".repeat(32),
      R2_ACCESS_KEY_ID: "key",
      R2_SECRET_ACCESS_KEY: "secret",
      R2_BUCKET: "media",
    };
    expect(createStorageEnv(input).R2_BUCKET).toBe("media");
    expect(() => createStorageEnv({ ...input, R2_ACCOUNT_ID: "bad-secret-account" })).toThrow(
      "Private media storage is not configured.",
    );
    expect(() => createStorageEnv({ ...input, R2_BUCKET: "" })).toThrow(
      "Private media storage is not configured.",
    );
  });

  it("keeps desktop renderer overrides restricted to local HTTP", () => {
    expect(createDesktopEnv({}).SIDECUT_RENDERER_URL).toBeUndefined();
    expect(
      createDesktopEnv({ SIDECUT_RENDERER_URL: "http://127.0.0.1:3000" }).SIDECUT_RENDERER_URL,
    ).toBe("http://127.0.0.1:3000");
    for (const url of [
      "https://localhost:3000",
      "http://remote.example",
      "file:///tmp/index.html",
    ]) {
      expect(() => createDesktopEnv({ SIDECUT_RENDERER_URL: url })).toThrow();
    }
  });
});
