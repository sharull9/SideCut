import { describe, it, expect } from "vite-plus/test";
import { createLUTLoader } from "./lut";
import { sampleCube } from "@sidecut/core/cube-lut";
import type { LocalResource } from "./storage";
describe("local LUT loader", () => {
  it("reports missing files and refreshes a cached same-name replacement", async () => {
    let value: LocalResource | null = null;
    const load = createLUTLoader(async (id) => (id === "lut:grade.cube" ? value : null));
    await expect(load("grade.cube")).rejects.toThrow(/missing/);
    value = {
      file: new File(["LUT_1D_SIZE 2\n0 0 0\n1 1 1"], "grade.cube", { lastModified: 1 }),
      state: "available",
      detail: "hash-one",
    };
    const first = await load("grade.cube");
    expect(sampleCube(first, [0, 0, 0])).toEqual([0, 0, 0]);
    expect(await load("grade.cube")).toBe(first);
    value = {
      file: new File(["LUT_1D_SIZE 2\n1 1 1\n0 0 0"], "grade.cube", { lastModified: 1 }),
      state: "available",
      detail: "hash-two",
    };
    expect(sampleCube(await load("grade.cube"), [0, 0, 0])).toEqual([1, 1, 1]);
    value = null;
    await expect(load("grade.cube")).rejects.toThrow(/missing/);
  });
});
