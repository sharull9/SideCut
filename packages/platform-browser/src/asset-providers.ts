import {
  AssetProviders,
  assetLicence,
  type ProviderEnvironment,
  type FetchedAsset,
  type ProviderInfo,
  ProviderError,
} from "@sidecut/assets";
import { decodeAsset, type Asset } from "@sidecut/contracts/assets";
import { decodeProviderQuery, decodeGeneration } from "@sidecut/contracts/providers";
import { folderAssets } from "@sidecut/assets/import-folders";
import { normalizeAsset, type AssetLibrary, type LibraryEntry } from "./asset-library";
import { browserProviderEnvironment } from "./providers";
export { assetLicence } from "@sidecut/assets";
export interface ProviderBridge {
  providerCall: (id: string, request: unknown) => Promise<unknown>;
  providerCancel: (id: string) => Promise<void>;
  providerCredential: (provider: string, action: "set" | "clear", secret?: string) => Promise<void>;
}
export const providerBridge = () => {
  const bridge = (globalThis as unknown as { sidecutDesktop?: ProviderBridge }).sidecutDesktop;
  return typeof bridge?.providerCall === "function" ? bridge : undefined;
};
export class BrowserAssetProviders {
  private engine: AssetProviders;
  constructor(
    private library: AssetLibrary,
    env: ProviderEnvironment = browserProviderEnvironment(),
    private bridge = providerBridge(),
  ) {
    this.engine = new AssetProviders({
      ...env,
      localAssets: async (id) =>
        (await library.entries()).map((e) => e.asset).filter((a) => a.provider === id),
      localFiles: async (asset) => {
        const e = await library.get(asset.id);
        return e?.original
          ? [
              {
                name: e.original.name,
                type: e.original.type,
                bytes: await e.original.arrayBuffer(),
              },
            ]
          : [];
      },
    });
  }
  private async call(request: unknown, signal: AbortSignal) {
    if (!this.bridge)
      throw new ProviderError(
        "unsupported",
        "desktop",
        "Desktop credential transport is unavailable.",
      );
    signal.throwIfAborted();
    const id = crypto.randomUUID(),
      abort = () => {
        void this.bridge!.providerCancel(id).catch(() => {});
      };
    signal.addEventListener("abort", abort, { once: true });
    try {
      return await this.bridge.providerCall(id, request);
    } finally {
      signal.removeEventListener("abort", abort);
    }
  }
  async list(): Promise<ProviderInfo[]> {
    if (!this.bridge) return this.engine.list();
    const raw = await this.call({ operation: "list" }, new AbortController().signal);
    if (!Array.isArray(raw)) throw new Error("Invalid provider status response.");
    return raw.map((v) => {
      if (
        !v ||
        typeof v.id !== "string" ||
        !Array.isArray(v.kinds) ||
        typeof v.capabilities?.search !== "boolean" ||
        !["ready", "needsKey", "disabled", "stub", "limited", "unsupported"].includes(
          v.status?.state,
        )
      )
        throw new Error("Invalid provider status response.");
      return v as ProviderInfo;
    });
  }
  async search(id: string, query: unknown, signal: AbortSignal) {
    const q = decodeProviderQuery(query),
      result =
        this.bridge && !["shared", "import"].includes(id)
          ? await this.call({ operation: "search", provider: id, query: q }, signal)
          : await this.engine.search(id, q, signal);
    if (!Array.isArray(result)) throw new Error("Invalid provider search response.");
    signal.throwIfAborted();
    return result.map(decodeAsset);
  }
  private fetched(value: unknown): FetchedAsset {
    const raw = value as FetchedAsset;
    if (!raw || !Array.isArray(raw.files) || !raw.files.length)
      throw new Error("Provider returned no files.");
    const asset = decodeAsset(raw.asset);
    for (const f of raw.files)
      if (
        typeof f.name !== "string" ||
        !f.name ||
        f.name.includes("/") ||
        f.name.includes("\\") ||
        typeof f.type !== "string" ||
        !(f.bytes instanceof ArrayBuffer) ||
        f.bytes.byteLength > 64 * 1024 * 1024
      )
        throw new Error("Invalid provider file response.");
    return { asset, files: raw.files };
  }
  async storeFetched(value: unknown) {
    const fetched = this.fetched(value),
      files = fetched.files.map((f) => new File([f.bytes], f.name, { type: f.type })),
      licence = new File([JSON.stringify(assetLicence(fetched.asset), null, 2)], "licence.json", {
        type: "application/json",
      });
    let failure: unknown;
    for (const file of files) {
      try {
        const entry = await normalizeAsset(file, fetched.asset, licence);
        entry.original = files[0]!;
        entry.extras = files.slice(1);
        if (entry.asset.kind === "font") {
          const { importFont } = await import("./text");
          for (const extra of files.slice(1)) await importFont(extra);
        }
        await this.library.put(entry);
        return entry;
      } catch (e) {
        failure = e;
      }
    }
    await this.library.put({
      asset: decodeAsset({ ...fetched.asset, state: "original" }),
      original: files[0]!,
      extras: files.slice(1),
      licence,
    });
    throw failure ?? new Error("Provider files could not be normalized.");
  }
  async fetch(asset: Asset, signal: AbortSignal) {
    const known = await this.library.get(asset.id);
    if (known?.normalised) return known;
    let raw: unknown;
    if (known?.original) {
      raw = {
        asset: known.asset,
        files: await Promise.all(
          [known.original, ...(known.extras ?? [])].map(async (f) => ({
            name: f.name,
            type: f.type,
            bytes: await f.arrayBuffer(),
          })),
        ),
      };
    } else
      raw =
        this.bridge && !["shared", "import"].includes(asset.provider)
          ? await this.call({ operation: "fetch", asset }, signal)
          : await this.engine.fetch(asset, signal);
    signal.throwIfAborted();
    const fetched = this.fetched(raw);
    if (fetched.asset.id !== asset.id) throw new Error("Fetched asset identity changed.");
    return this.storeFetched(fetched);
  }
  async generate(value: unknown, confirmedPaid: boolean, signal: AbortSignal) {
    const request = decodeGeneration(value);
    if (confirmedPaid !== true) throw new Error("Confirm the paid request before generation.");
    if (this.bridge) {
      const raw = (await this.call(
        { operation: "generate", provider: "elevenlabs", request, confirmedPaid: true },
        signal,
      )) as { takes: unknown[]; failures: string[] };
      if (!Array.isArray(raw?.takes) || !Array.isArray(raw.failures))
        throw new Error("Invalid generation response.");
      const entries: LibraryEntry[] = [];
      const failures = [...raw.failures];
      for (const take of raw.takes)
        try {
          entries.push(await this.storeFetched(take));
        } catch {
          failures.push(
            "A generated take could not be normalized. Its original remains in desktop generated storage.",
          );
        }
      return { entries, failures };
    }
    const entries: LibraryEntry[] = [];
    const result = await this.engine.generate("elevenlabs", request, true, signal, async (take) => {
      entries.push(await this.storeFetched(take));
    });
    return { entries, failures: result.failures };
  }
  async recoverGenerated(signal: AbortSignal) {
    const values = await this.call({ operation: "generated" }, signal);
    if (!Array.isArray(values)) throw new Error("Invalid generated asset list.");
    return values.map(decodeAsset);
  }
  async importFolder(files: readonly File[], provider: "shared" | "import", signal: AbortSignal) {
    const entries = files.map((file) => ({ file, path: file.webkitRelativePath || file.name })),
      root = entries[0]?.path.split("/")[0] ?? "library";
    const relative = entries.map((e) => ({
      ...e,
      path: e.path.startsWith(`${root}/`) ? e.path.slice(root.length + 1) : e.path,
    }));
    const notes: Record<string, unknown> = {};
    for (const e of relative)
      if (e.path.endsWith("tandem-licence.json")) {
        if (e.file.size > 1024 * 1024) throw new Error("Folder licence is too large.");
        notes[e.path.slice(0, -"tandem-licence.json".length).replace(/\/$/, "")] = JSON.parse(
          await e.file.text(),
        );
      }
    const plans = folderAssets(
        relative.map((e) => ({ path: e.path, size: e.file.size })),
        provider,
        notes,
      ),
      result: LibraryEntry[] = [];
    for (const plan of plans) {
      signal.throwIfAborted();
      const source = relative.find((e) => e.path === plan.providerID)!.file,
        asset = decodeAsset({
          ...plan,
          providerID: provider === "import" ? `${root}/${plan.providerID}` : plan.providerID,
          id: undefined,
        }),
        old = await this.library.get(asset.id);
      if (old) {
        result.push(old);
        continue;
      }
      const licence = new File([JSON.stringify(assetLicence(asset))], "licence.json", {
        type: "application/json",
      });
      const entry = await normalizeAsset(source, asset, licence);
      await this.library.put(entry);
      result.push(entry);
    }
    return result;
  }
}
