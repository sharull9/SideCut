import { it, expect } from "vite-plus/test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CloudProvider,
  activeTeamStorageKey,
  readActiveTeamId,
  safeReturnTo,
  useCloud,
  writeActiveTeamId,
} from "./cloud-provider";

function memoryStorage(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => {
      items.set(key, value);
    },
    removeItem: (key: string) => {
      items.delete(key);
    },
  };
}

function Probe() {
  const cloud = useCloud();
  return <p>{`configured:${String(cloud.configured)};team:${cloud.activeTeamId ?? "none"}`}</p>;
}

it("reads the stored active team id and treats empty values as unset", () => {
  expect(readActiveTeamId(memoryStorage())).toBeNull();
  expect(readActiveTeamId(memoryStorage({ [activeTeamStorageKey]: "team_1" }))).toBe("team_1");
  expect(readActiveTeamId(memoryStorage({ [activeTeamStorageKey]: "" }))).toBeNull();
});

it("writes and clears the active team id", () => {
  const storage = memoryStorage();
  writeActiveTeamId("team_2", storage);
  expect(storage.items.get(activeTeamStorageKey)).toBe("team_2");
  writeActiveTeamId(null, storage);
  expect(storage.items.has(activeTeamStorageKey)).toBe(false);
});

it("falls back to unset when storage is unavailable", () => {
  const blocked = {
    getItem: () => {
      throw new Error("SecurityError");
    },
    setItem: () => {
      throw new Error("QuotaExceededError");
    },
    removeItem: () => {
      throw new Error("SecurityError");
    },
  };
  expect(readActiveTeamId(blocked)).toBeNull();
  expect(() => writeActiveTeamId("team_3", blocked)).not.toThrow();
  expect(() => writeActiveTeamId(null, blocked)).not.toThrow();
});

it("accepts only same-origin relative paths as a return target", () => {
  expect(safeReturnTo("/cloud?section=team")).toBe("/cloud?section=team");
  expect(safeReturnTo("/")).toBe("/");
  expect(safeReturnTo("/studio/../cloud")).toBe("/studio/../cloud");
  expect(safeReturnTo("//evil.example/path")).toBeNull();
  expect(safeReturnTo("/\\evil.example")).toBeNull();
  expect(safeReturnTo("https://evil.example/")).toBeNull();
  expect(safeReturnTo("javascript:alert(1)")).toBeNull();
  expect(safeReturnTo("cloud")).toBeNull();
  expect(safeReturnTo("/cloud\nSet-Cookie")).toBeNull();
  expect(safeReturnTo("")).toBeNull();
  expect(safeReturnTo(undefined)).toBeNull();
  expect(safeReturnTo(null)).toBeNull();
  expect(safeReturnTo({ returnTo: "/" })).toBeNull();
});

it("renders children as unconfigured with no team when cloud config is absent", () => {
  // Node has no window, so browserCloudConfig() returns null and no client or AuthKit is created.
  expect(
    renderToStaticMarkup(
      <CloudProvider>
        <Probe />
      </CloudProvider>,
    ),
  ).toBe("<p>configured:false;team:none</p>");
});
