import { mkdir, readFile, writeFile, rename, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { AssetProviders, type FetchedAsset, type ProviderEnvironment } from "@sidecut/assets";
import { authenticatedRequest, readProviderResponse } from "@sidecut/assets/transport";
import { decodeAsset } from "@sidecut/contracts/assets";
import { ProviderCredentials } from "./provider-credentials.ts";

export class DesktopAssetProviders {
  readonly credentials: ProviderCredentials;
  private engine: AssetProviders;
  private settings = { freesound: false };
  constructor(private readonly folder: string) {
    this.credentials = new ProviderCredentials(join(folder, "credentials"));
    const cacheFile = (key: string) =>
      join(folder, "provider-cache", `${createHash("sha256").update(key).digest("hex")}.json`);
    const env: ProviderEnvironment = {
      mode: "host",
      hasCredential: (id) => this.credentials.has(id),
      enabled: (id) => id === "freesound" && this.settings.freesound,
      cacheGet: async (key) => {
        try {
          return JSON.parse(await readFile(cacheFile(key), "utf8"));
        } catch {
          return undefined;
        }
      },
      cachePut: async (key, value) => {
        await mkdir(join(folder, "provider-cache"), { recursive: true });
        const file = cacheFile(key),
          temporary = `${file}.${crypto.randomUUID()}.tmp`;
        await writeFile(temporary, JSON.stringify(value));
        await rename(temporary, file);
      },
      request: async (request) => {
        const secret = request.auth ? await this.credentials.read(request.provider) : undefined,
          { url, headers } = authenticatedRequest(request, secret);
        const response = await fetch(url, {
          method: request.method ?? "GET",
          headers,
          ...(request.body ? { body: request.body } : {}),
          signal: request.signal,
          redirect: "error",
        });
        return readProviderResponse(response);
      },
    };
    this.engine = new AssetProviders(env);
  }
  private generatedFolder(id: string) {
    if (!/^elevenlabs:(music|sfx)_[a-z0-9-]+$/i.test(id))
      throw new Error("Invalid generated asset ID.");
    return join(this.folder, "generated", id.replace(":", "_"));
  }
  private async saveTake(take: FetchedAsset) {
    const folder = this.generatedFolder(take.asset.id);
    await mkdir(folder, { recursive: true });
    for (const f of take.files) {
      if (!/^[a-z0-9._-]+$/i.test(f.name)) throw new Error("Invalid generated filename.");
      await writeFile(join(folder, f.name), new Uint8Array(f.bytes), { flag: "wx" });
    }
    await writeFile(
      join(folder, "asset.json"),
      JSON.stringify({
        asset: take.asset,
        files: take.files.map((f) => ({ name: f.name, type: f.type })),
      }),
      { flag: "wx" },
    );
  }
  private async generated(id: string): Promise<FetchedAsset> {
    const folder = this.generatedFolder(id),
      meta = JSON.parse(await readFile(join(folder, "asset.json"), "utf8"));
    const asset = decodeAsset(meta.asset);
    if (asset.id !== id || !Array.isArray(meta.files))
      throw new Error("Invalid generated asset manifest.");
    const files = [];
    for (const f of meta.files) {
      if (typeof f.name !== "string" || !/^[a-z0-9._-]+$/i.test(f.name))
        throw new Error("Invalid generated resource.");
      const data = await readFile(join(folder, f.name));
      files.push({ name: f.name, type: String(f.type), bytes: new Uint8Array(data).buffer });
    }
    return { asset, files };
  }
  async call(value: unknown, signal: AbortSignal) {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("Invalid provider call.");
    const r = value as Record<string, unknown>;
    if (r.operation === "list") return this.engine.list();
    if (r.operation === "search" && typeof r.provider === "string")
      return this.engine.search(r.provider, r.query, signal);
    if (r.operation === "similar" && typeof r.limit === "number")
      return this.engine.similar(r.asset, r.limit, signal);
    if (r.operation === "fetch") {
      const asset = decodeAsset(r.asset);
      return asset.provider === "elevenlabs"
        ? this.generated(asset.id)
        : this.engine.fetch(asset, signal);
    }
    if (r.operation === "generate" && typeof r.provider === "string")
      return this.engine.generate(r.provider, r.request, r.confirmedPaid === true, signal, (take) =>
        this.saveTake(take),
      );
    if (r.operation === "generated") {
      const root = join(this.folder, "generated"),
        rows = [];
      for (const name of (await readdir(root).catch(() => [])).slice(0, 100)) {
        try {
          const meta = JSON.parse(await readFile(join(root, name, "asset.json"), "utf8"));
          rows.push(decodeAsset(meta.asset));
        } catch {
          /* Incomplete manifests never masquerade as completed takes. */
        }
      }
      return rows;
    }
    if (
      r.operation === "configure" &&
      r.provider === "freesound" &&
      typeof r.enabled === "boolean"
    ) {
      this.settings.freesound = r.enabled;
      return null;
    }
    throw new Error("Unsupported provider operation.");
  }
}
