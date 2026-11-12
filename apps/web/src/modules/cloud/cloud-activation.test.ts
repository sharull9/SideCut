import { describe, expect, it } from "vite-plus/test";
import {
  cloudUsedStorageKey,
  hasOAuthCallback,
  isCloudPath,
  markCloudUsed,
  parseBillingFlag,
  readCloudUsed,
  shouldActivateCloud,
  type ActivationInput,
} from "./cloud-activation";

const dormant: ActivationInput = {
  configured: true,
  pathname: "/",
  search: "",
  rememberedSignIn: false,
  billingBuildFlag: false,
};

function memoryStorage(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => {
      items.set(key, value);
    },
  };
}

describe("shouldActivateCloud", () => {
  it("stays dormant when cloud is not configured, whatever else is true", () => {
    expect(
      shouldActivateCloud({
        configured: false,
        pathname: "/cloud",
        search: "?code=a&state=b",
        rememberedSignIn: true,
        billingBuildFlag: true,
      }),
    ).toBe(false);
  });

  it("stays dormant on a plain page with no signals", () => {
    expect(shouldActivateCloud(dormant)).toBe(false);
    expect(shouldActivateCloud({ ...dormant, pathname: "/studio" })).toBe(false);
    expect(shouldActivateCloud({ ...dormant, pathname: "/diagnostics" })).toBe(false);
  });

  it("activates on cloud, login and callback paths", () => {
    expect(shouldActivateCloud({ ...dormant, pathname: "/cloud" })).toBe(true);
    expect(shouldActivateCloud({ ...dormant, pathname: "/cloud/teams" })).toBe(true);
    expect(shouldActivateCloud({ ...dormant, pathname: "/login" })).toBe(true);
    expect(shouldActivateCloud({ ...dormant, pathname: "/callback" })).toBe(true);
  });

  it("activates when the URL carries an OAuth code and state on any page", () => {
    expect(shouldActivateCloud({ ...dormant, search: "?code=abc&state=xyz" })).toBe(true);
  });

  it("activates for a returning user who has used cloud before", () => {
    expect(shouldActivateCloud({ ...dormant, rememberedSignIn: true })).toBe(true);
  });

  it("activates when billing is enabled for this build", () => {
    expect(shouldActivateCloud({ ...dormant, billingBuildFlag: true })).toBe(true);
  });
});

describe("isCloudPath", () => {
  it("matches whole path segments only", () => {
    expect(isCloudPath("/cloud")).toBe(true);
    expect(isCloudPath("/cloud/")).toBe(true);
    expect(isCloudPath("/cloudy")).toBe(false);
    expect(isCloudPath("/loginx")).toBe(false);
    expect(isCloudPath("/")).toBe(false);
    expect(isCloudPath("/studio")).toBe(false);
    expect(isCloudPath("/x/cloud")).toBe(false);
  });
});

describe("hasOAuthCallback", () => {
  it("requires both code and state", () => {
    expect(hasOAuthCallback("?code=a&state=b")).toBe(true);
    expect(hasOAuthCallback("?code=a")).toBe(false);
    expect(hasOAuthCallback("?state=b")).toBe(false);
    expect(hasOAuthCallback("")).toBe(false);
  });
});

describe("parseBillingFlag", () => {
  it("is on only for the exact values true and 1", () => {
    expect(parseBillingFlag("true")).toBe(true);
    expect(parseBillingFlag("1")).toBe(true);
    expect(parseBillingFlag("TRUE")).toBe(false);
    expect(parseBillingFlag("yes")).toBe(false);
    expect(parseBillingFlag("")).toBe(false);
    expect(parseBillingFlag(undefined)).toBe(false);
  });
});

describe("cloud used flag", () => {
  it("is unset until marked, then remembered", () => {
    const storage = memoryStorage();
    expect(readCloudUsed(storage)).toBe(false);
    markCloudUsed(storage);
    expect(storage.items.get(cloudUsedStorageKey)).toBe("1");
    expect(readCloudUsed(storage)).toBe(true);
  });

  it("treats blocked storage as unset and does not throw", () => {
    const blocked = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(readCloudUsed(blocked)).toBe(false);
    expect(() => markCloudUsed(blocked)).not.toThrow();
  });
});
