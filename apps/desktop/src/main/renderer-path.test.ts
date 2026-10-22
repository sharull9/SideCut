import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { resolveRendererPath, shellFile } from "./renderer-path.ts";

const root = join("/srv", "public");

describe("resolveRendererPath", () => {
  it("serves the shell for application routes", () => {
    expect(resolveRendererPath(root, "/")).toBe(join(root, shellFile));
    expect(resolveRendererPath(root, "/diagnostics")).toBe(join(root, shellFile));
  });

  it("serves existing asset paths", () => {
    expect(resolveRendererPath(root, "/assets/index-abc.js")).toBe(
      join(root, "assets", "index-abc.js"),
    );
    expect(resolveRendererPath(root, "/a%20b.wasm")).toBe(join(root, "a b.wasm"));
  });

  it("rejects paths outside the renderer root", () => {
    expect(resolveRendererPath(root, "/../secret.txt")).toBeUndefined();
    expect(resolveRendererPath(root, "/%2e%2e/secret.txt")).toBeUndefined();
    expect(resolveRendererPath(root, "/assets/%2e%2e%2f%2e%2e%2fsecret.txt")).toBeUndefined();
    expect(resolveRendererPath(root, "/%E0%A4%A")).toBeUndefined();
    expect(resolveRendererPath(root, "/a%00.js")).toBeUndefined();
  });
});
