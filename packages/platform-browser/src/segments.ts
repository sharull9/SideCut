import { decodeSegment, type SavedSegment } from "@sidecut/core/segments";
import type { LocalResource } from "./storage";
export interface SegmentEntry {
  segment: SavedSegment;
  resources: Record<string, LocalResource>;
}
const request = <T>(r: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
export class SegmentLibrary {
  private constructor(private db: IDBDatabase) {}
  static async open() {
    const r = indexedDB.open("sidecut-segments", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("segments");
    return new SegmentLibrary(await request(r));
  }
  async list(query = "") {
    const entries = await request<SegmentEntry[]>(
      this.db.transaction("segments").objectStore("segments").getAll(),
    );
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return entries
      .map((e) => ({ ...e, segment: decodeSegment(e.segment) }))
      .filter((e) => words.every((w) => e.segment.name.toLowerCase().includes(w)))
      .sort((a, b) => a.segment.name.localeCompare(b.segment.name));
  }
  async save(entry: SegmentEntry) {
    const segment = decodeSegment(JSON.parse(JSON.stringify(entry.segment)));
    let size = 0;
    for (const r of segment.resources) {
      const file = entry.resources[r.path];
      if (file?.state !== "available")
        throw new Error(`Segment resource ${r.path} is missing. Relink it first.`);
      size += file.file.size;
    }
    if (size > 256 * 1024 * 1024) throw new Error("Saved segment exceeds 256 MiB.");
    await new Promise<void>((resolve, reject) => {
      const tx = this.db.transaction("segments", "readwrite");
      tx.objectStore("segments").add(
        { ...entry, segment: JSON.parse(JSON.stringify(segment)) },
        segment.id,
      );
      tx.oncomplete = () => resolve();
      tx.onabort = () =>
        reject(
          new Error(
            "Segment was not saved. Its name may already exist, or browser storage is full.",
          ),
        );
    });
  }
  close() {
    this.db.close();
  }
}
