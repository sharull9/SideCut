import { BufferTarget, StreamTarget } from "mediabunny";
const releases = new WeakMap<Blob, () => Promise<void>>();
export const diskExport = (blob: Blob) => releases.has(blob);
export async function releaseExport(blob: Blob) {
  const release = releases.get(blob);
  releases.delete(blob);
  await release?.();
}
/** Keep large output off the JS heap; the download owns its spool file until removal. */
export async function exportOutput(large: boolean) {
  if (!large) {
    const target = new BufferTarget();
    target.on("write", ({ end }) => {
      if (end > 256 * 1024 * 1024)
        throw new Error("In-memory export exceeds 256 MiB. Use a file-backed long export.");
    });
    return {
      target,
      finish: async () => {
        if (!target.buffer) throw new Error("Export did not produce a file.");
        return new Blob([target.buffer], { type: "video/webm" });
      },
      cancel: async () => {},
    };
  }
  if (!navigator.storage?.getDirectory)
    throw new Error("Large exports require local file storage (OPFS). Use the desktop app.");
  const root = await navigator.storage.getDirectory();
  const folder = await root.getDirectoryHandle("sidecut-exports", { create: true });
  const id = crypto.randomUUID(),
    file = await folder.getFileHandle(id, { create: true });
  const writer = await file.createWritable();
  const remove = async () => {
    await folder.removeEntry(id);
  };
  const target = new StreamTarget(
    new WritableStream({
      write: (chunk: { type: "write"; position: number; data: Uint8Array<ArrayBuffer> }) =>
        writer.write(chunk),
      close: () => writer.close(),
      abort: () => writer.abort(),
    }),
    { chunked: true, chunkSize: 1024 * 1024 },
  );
  return {
    target,
    finish: async () => {
      const blob = new File([await file.getFile()], `${id}.webm`, { type: "video/webm" });
      releases.set(blob, remove);
      return blob;
    },
    cancel: async () => {
      await writer.abort().catch(() => {});
      await remove().catch(() => {});
    },
  };
}
