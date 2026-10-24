import { describe, it, expect } from "vite-plus/test";
import { folderAssets } from "./import-folders.ts";
import { localProvider } from "./local.ts";
import { decodeProviderQuery } from "@sidecut/contracts/providers";
import { mockEnvironment } from "./test-support.ts";
describe("108.02 import folders", () => {
  it("uses the nearest licence and preserves stable relative IDs", async () => {
    const assets = folderAssets(
      [{ path: "Music/intro.wav" }, { path: "Music/README.md" }, { path: ".cache/a.png" }],
      "import",
      {
        "": { licenceClass: "unknown" },
        Music: { licenceClass: "creditNeeded", credit: "Composer", kind: "music" },
      },
    );
    expect(assets).toHaveLength(1);
    expect(assets[0]).toMatchObject({
      id: "import:Music/intro.wav",
      kind: "music",
      creditLine: "Composer",
    });
    const { env } = mockEnvironment();
    env.localAssets = async () => assets;
    expect(
      await localProvider(env, "import").search(
        decodeProviderQuery({ text: "intro" }),
        new AbortController().signal,
      ),
    ).toEqual(assets);
  });
  it("rejects traversal and excludes segments from the shared provider", () => {
    expect(() => folderAssets([{ path: "../private.png" }], "import")).toThrow("root");
    expect(folderAssets([{ path: "Segments/intro.png" }], "shared")).toEqual([]);
  });
});
