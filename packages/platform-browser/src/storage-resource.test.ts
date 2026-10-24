import { it, expect } from "vite-plus/test";
import { storedResource } from "./storage";
it("restores native File and byte-backed resources with exact File metadata", async () => {
  const file = new File(["portable"], "侧剪 source.wav", { type: "audio/wav", lastModified: 123 });
  const native = { file, state: "available", detail: "Local source" };
  expect(storedResource(native)?.file).toBe(file);
  const restored = storedResource({
    ...native,
    file: {
      bytes: await file.arrayBuffer(),
      name: file.name,
      type: file.type,
      lastModified: file.lastModified,
    },
  });
  expect(await restored?.file.text()).toBe("portable");
  expect(restored?.file.name).toBe(file.name);
  expect(restored?.file.lastModified).toBe(123);
  expect(storedResource({ ...native, file: { bytes: "wrong" } })).toBe(null);
});
