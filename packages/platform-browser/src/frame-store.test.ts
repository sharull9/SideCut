import { it, expect, vi } from "vite-plus/test";
import { DurableStorage } from "./sqlite-client";
import { storeFrame, readFrame, removeFrames, portableFrameReferences } from "./frame-store";
it("stores frame bytes separately, loads on demand, makes portable archives and cleans canceled frames", async () => {
  const files = new Map<string, Uint8Array<ArrayBuffer>>();
  const db = {
    native: false,
    request: async () => [],
    putFile: async (value: Uint8Array) => {
      const id = crypto.randomUUID();
      files.set(id, new Uint8Array(value));
      return id;
    },
    getFile: async (id: string) => {
      const value = files.get(id);
      if (!value) throw new Error("Missing file");
      return value;
    },
    removeFile: async (id: string) => {
      files.delete(id);
    },
  };
  const opened = vi.spyOn(DurableStorage, "open").mockResolvedValue(db);
  try {
    const image = await storeFrame(new Blob(["pixels"], { type: "image/png" }));
    expect(image).not.toBeInstanceOf(Blob);
    expect(await (await readFrame(image)).text()).toBe("pixels");
    const portable = await portableFrameReferences({ frames: [{ image }] });
    expect(portable).toEqual({ frames: [{ image: new Blob(["pixels"], { type: "image/png" }) }] });
    await expect(portableFrameReferences({ frames: [{ image }] }, 2)).rejects.toThrow(/budget/);
    await removeFrames([{ image }]);
    expect(files.size).toBe(0);
  } finally {
    opened.mockRestore();
  }
});
