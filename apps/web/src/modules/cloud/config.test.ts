import { it, expect } from "vite-plus/test";
import { cloudConfig } from "./config";

it("keeps unconfigured and desktop origins local", () => {
  expect(cloudConfig({}, "https://sidecut.example")).toBeNull();
  expect(
    cloudConfig({ url: "https://example.convex.cloud", clientId: "client_test" }, "null"),
  ).toBeNull();
});

it("requires a production auth domain and disables local token storage in production", () => {
  const env = {
    url: "https://example.convex.cloud",
    clientId: "client_test",
    devMode: "true",
  };
  expect(cloudConfig(env, "https://sidecut.example")).toBeNull();
  expect(
    cloudConfig({ ...env, apiHostname: "auth.sidecut.example" }, "https://sidecut.example"),
  ).toMatchObject({ devMode: false, redirectUri: "https://sidecut.example/team" });
});

it("passes Convex a backend URL without a trailing slash", () => {
  expect(
    cloudConfig(
      { url: "https://example.convex.cloud/", clientId: "client_test" },
      "http://localhost:3000",
    )?.url,
  ).toBe("https://example.convex.cloud");
});

it("uses the registered redirect URI when provided", () => {
  const env = { url: "https://example.convex.cloud", clientId: "client_test" };
  expect(cloudConfig(env, "http://localhost:3000")).toMatchObject({
    redirectUri: "http://localhost:3000/team",
  });
  expect(
    cloudConfig({ ...env, redirectUri: "http://localhost:3000/callback" }, "http://localhost:3000"),
  ).toMatchObject({ redirectUri: "http://localhost:3000/callback" });
});

it("permits explicit local development and rejects insecure remote backends", () => {
  expect(
    cloudConfig(
      {
        url: "http://127.0.0.1:3210",
        clientId: "client_test",
        devMode: "true",
      },
      "http://localhost:3000",
    ),
  ).toMatchObject({ devMode: true });
  expect(
    cloudConfig({ url: "http://remote.example", clientId: "client_test" }, "http://localhost:3000"),
  ).toBeNull();
});
