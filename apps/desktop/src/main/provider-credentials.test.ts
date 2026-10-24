import { beforeEach, afterEach, describe, it, expect, vi } from "vite-plus/test";
import { mkdtemp, readFile, readdir, unlink, rmdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
const encryption = vi.hoisted(() => ({
  available: true,
  encrypt: vi.fn(() => Buffer.from("opaque-os-encrypted-data")),
  decrypt: vi.fn(() => "fake-test-credential"),
}));
vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => encryption.available,
    getSelectedStorageBackend: () => "kwallet6",
    encryptString: encryption.encrypt,
    decryptString: encryption.decrypt,
  },
}));
import { ProviderCredentials } from "./provider-credentials.ts";
describe("provider credential boundary", () => {
  let folder: string;
  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), "sidecut-provider-test-"));
    encryption.available = true;
    vi.clearAllMocks();
  });
  afterEach(async () => {
    for (const name of await readdir(folder)) await unlink(join(folder, name));
    await rmdir(folder);
  });
  it("stores only OS-encrypted bytes and supports removal", async () => {
    const store = new ProviderCredentials(folder);
    await store.set("pexels", "fake-test-credential");
    expect(encryption.encrypt).toHaveBeenCalledWith("fake-test-credential");
    expect(await readFile(join(folder, "pexels.enc"), "utf8")).not.toContain(
      "fake-test-credential",
    );
    expect(await store.has("pexels")).toBe(true);
    await store.clear("pexels");
    expect(await readdir(folder)).toEqual([]);
  });
  it("refuses to store credentials without OS encryption", async () => {
    encryption.available = false;
    await expect(
      new ProviderCredentials(folder).set("pixabay", "fake-test-credential"),
    ).rejects.toThrow("unavailable");
    expect(await readdir(folder)).toEqual([]);
  });
  it("rejects unrecognized provider names before touching files", async () => {
    await expect(
      new ProviderCredentials(folder).set("../escape", "fake-test-credential"),
    ).rejects.toThrow("Unknown");
    expect(await readdir(folder)).toEqual([]);
  });
});
