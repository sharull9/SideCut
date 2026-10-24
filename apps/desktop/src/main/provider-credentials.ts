import { safeStorage } from "electron";
import { readFile, mkdir, writeFile, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
export const keyedProviders = ["pixabay", "pexels", "freesound", "elevenlabs"] as const;
export class ProviderCredentials {
  constructor(private readonly folder: string) {}
  private file(provider: string) {
    if (!(keyedProviders as readonly string[]).includes(provider))
      throw new Error("Unknown credential provider.");
    return join(this.folder, `${provider}.enc`);
  }
  private available() {
    if (
      !safeStorage.isEncryptionAvailable() ||
      (process.platform === "linux" && safeStorage.getSelectedStorageBackend() === "basic_text")
    )
      throw new Error(
        "OS credential encryption is unavailable. Configure an OS keyring before adding provider credentials.",
      );
  }
  async has(provider: string) {
    try {
      return Boolean(await this.read(provider));
    } catch {
      return false;
    }
  }
  async read(provider: string) {
    const file = this.file(provider);
    this.available();
    try {
      return safeStorage.decryptString(await readFile(file));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw new Error("Provider credential could not be decrypted. Configure it again.", {
        cause: e,
      });
    }
  }
  async set(provider: string, value: unknown) {
    const file = this.file(provider);
    if (typeof value !== "string" || !value.trim() || value.length > 4096)
      throw new Error("Invalid provider credential.");
    this.available();
    await mkdir(this.folder, { recursive: true });
    const temporary = `${file}.${crypto.randomUUID()}.tmp`;
    try {
      await writeFile(temporary, safeStorage.encryptString(value.trim()), {
        mode: 0o600,
        flag: "wx",
      });
      await rename(temporary, file);
    } finally {
      await unlink(temporary).catch(() => {});
    }
  }
  async clear(provider: string) {
    await unlink(this.file(provider)).catch((e) => {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    });
  }
}
