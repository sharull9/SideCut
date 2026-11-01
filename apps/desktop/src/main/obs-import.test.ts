import { afterEach, describe, expect, it } from "vite-plus/test";
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { readOBSSource } from "./obs-import.ts";
import { HostProjectService } from "./project-service.ts";
import { NativeProjectStore } from "./project-store.ts";
import { ProjectAPI } from "./project-api.ts";
import { LocalHTTPService } from "./http-service.ts";
import collection from "../../../../tests/fixtures/obs/collection.json";

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const action of cleanup.reverse().splice(0)) await action();
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "sidecut-obs-"));
  cleanup.push(async () => {
    if (!root.startsWith(join(tmpdir(), "sidecut-obs-"))) throw new Error("Invalid cleanup path");
    await rm(root, { recursive: true, force: true });
  });
  const assets = join(root, "assets");
  await mkdir(assets);
  const bytes = await readFile(resolve("tests/fixtures/obs/logo.png"));
  await writeFile(join(assets, "logo.png"), bytes);
  const path = join(root, "collection.json");
  await writeFile(path, JSON.stringify(collection));
  const profile = join(root, "basic.ini");
  await writeFile(profile, await readFile(resolve("tests/fixtures/obs/basic.ini")));
  return { root, assets, path, profile, bytes };
}
const signal = () => new AbortController().signal;

describe("sandboxed OBS resources and host import", () => {
  it("imports through the real CLI, reads approved resources and reloads scene/report metadata from SQLite", async () => {
    const { root, bytes } = await fixture();
    const host = new HostProjectService(new NativeProjectStore(join(root, "current.tandem")));
    await host.start();
    cleanup.push(() => host.close());
    const api = new ProjectAPI(host);
    const service = new LocalHTTPService(api);
    const endpoint = await service.start();
    cleanup.push(() => service.close());
    const endpointPath = join(root, "endpoint.json");
    await writeFile(endpointPath, JSON.stringify(endpoint));
    const { stdout } = await promisify(execFile)(
      process.execPath,
      [
        resolve("scripts/sidecut-cli.mjs"),
        "import",
        "obs",
        "collection.json",
        "--profile",
        "basic.ini",
        "--asset-root",
        "assets",
        "--duration",
        "3",
        "--out",
        "snapshot",
        "--endpoint-file",
        endpointPath,
        "--json",
      ],
      { windowsHide: true },
    );
    const imported = JSON.parse(stdout);
    expect(imported).toMatchObject({
      name: "OBS fixture — Main",
      report: { format: "obs", clips: 4, media: 1, scenes: 2 },
    });
    expect(imported.report.warnings.join("\n")).toMatch(/browser_source/);
    await host.flush();
    const saved = await host.store.load(() => {
      throw new Error("Missing imported project");
    });
    expect(saved.project.media[0]?.path).toBe("assets/logo.png");
    expect(JSON.parse(saved.project.metadata.sidecutImportReport!).supportedSources).toContain(
      "color_source",
    );
    expect(JSON.stringify(saved)).not.toContain("PRIVATE_");
    expect((await api.readProjectResource(saved.project.media[0]!.id)).bytes).toEqual(
      new Uint8Array(bytes),
    );
    expect(
      JSON.parse(await readFile(join(root, "snapshot.tandem"), "utf8")).project.media[0].path,
    ).toBe("assets/logo.png");
  }, 15000);
  it("does not follow unapproved, traversing, URL or junction image references", async () => {
    const { root, assets, path, profile, bytes } = await fixture();
    const outside = await mkdtemp(join(tmpdir(), "sidecut-obs-external-"));
    cleanup.push(async () => {
      if (!outside.startsWith(join(tmpdir(), "sidecut-obs-external-")))
        throw new Error("Invalid cleanup path");
      await rm(outside, { recursive: true, force: true });
    });
    await writeFile(join(outside, "logo.png"), bytes);
    const noGrant = await readOBSSource(path, { projectRoot: root, profile }, signal());
    expect(noGrant.report.media).toBe(0);
    expect(noGrant.report.warnings.join("\n")).toMatch(/No asset root/);
    await symlink(outside, join(assets, "linked"), "junction");
    for (const file of [
      join(outside, "logo.png"),
      "../logo.png",
      "https://example.test/logo.png",
      "file:///private/logo.png",
      "linked/logo.png",
    ]) {
      const input = structuredClone(collection);
      input.sources.find((source) => source.name === "Logo")!.settings.file = file;
      await writeFile(path, JSON.stringify(input));
      const result = await readOBSSource(
        path,
        { projectRoot: root, profile, assetRoot: assets },
        signal(),
      );
      expect(result.report.media).toBe(0);
      expect(result.report.warnings.join("\n")).toMatch(/Image unavailable, unsafe/);
    }
    await expect(
      readOBSSource(path, { projectRoot: root, profile, assetRoot: outside }, signal()),
    ).rejects.toThrow(/inside the host project/);
  });
  it("keeps the existing project on invalid input, stale revisions or cancellation", async () => {
    const { root, path } = await fixture();
    const host = new HostProjectService(new NativeProjectStore(join(root, "current.tandem")));
    await host.start();
    cleanup.push(() => host.close());
    const api = new ProjectAPI(host);
    const before = host.snapshot().json;
    await expect(
      api.handle("import-obs", { path: "collection.json", expectedRevision: 999 }),
    ).rejects.toThrow(/changed/);
    expect(host.snapshot().json).toBe(before);
    const controller = new AbortController();
    controller.abort();
    await expect(
      api.handle("import-obs", { path: "collection.json", expectedRevision: 0 }, controller.signal),
    ).rejects.toThrow();
    expect(host.snapshot().json).toBe(before);
    await writeFile(path, "invalid json");
    await expect(
      api.handle("import-obs", { path: "collection.json", expectedRevision: 0 }),
    ).rejects.toThrow();
    expect(host.snapshot().json).toBe(before);
  });
  it("skips malformed PNG data without probing unsupported media sources", async () => {
    const { root, assets, path, profile } = await fixture();
    await writeFile(join(assets, "logo.png"), "not a PNG");
    const result = await readOBSSource(
      path,
      { projectRoot: root, assetRoot: assets, profile },
      signal(),
    );
    expect(result.report.media).toBe(0);
    expect(result.report.warnings.join("\n")).toMatch(/PNG limits/);
  });
});
