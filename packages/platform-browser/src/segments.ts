import { QueryError } from "@sidecut/core/project-queries";
import type { DurableStorage } from "./sqlite-client";
import { encodeStored, decodeStored } from "./storage-codec";
import { migrateLibrary } from "./legacy-storage";
import { storedResource } from "./storage";
import { decodeSegment, type SavedSegment } from "@sidecut/core/segments";
import type { LocalResource } from "./storage";
export interface SegmentEntry {
  segment: SavedSegment;
  resources: Record<string, LocalResource>;
}
function segmentEntry(value: unknown): SegmentEntry {
  if (
    !value ||
    typeof value !== "object" ||
    !("segment" in value) ||
    !("resources" in value) ||
    !value.resources ||
    typeof value.resources !== "object"
  )
    throw new Error("Invalid stored segment.");
  const resources: Record<string, LocalResource> = {};
  for (const [key, raw] of Object.entries(value.resources)) {
    const resource = storedResource(raw);
    if (!resource) throw new Error("Invalid segment resource.");
    resources[key] = resource;
  }
  return { segment: decodeSegment(JSON.parse(JSON.stringify(value.segment))), resources };
}
export class SegmentLibrary {
  private constructor(private db: DurableStorage) {}
  static async open() {
    return new SegmentLibrary(
      await migrateLibrary("segments", "sidecut-segments", "segments", segmentEntry),
    );
  }
  async inspect() {
    const rows = await this.db.request({ type: "read", collection: "segments" });
    const entries: SegmentEntry[] = [],
      problems: string[] = [];
    for (const row of rows) {
      try {
        entries.push(segmentEntry(await decodeStored(row.value, this.db)));
      } catch {
        problems.push(`${row.key}: Invalid stored segment.`);
      }
    }
    entries.sort((a, b) => a.segment.name.localeCompare(b.segment.name));
    return { entries, problems };
  }
  async list(query = "") {
    const { entries } = await this.inspect();
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return entries
      .filter((e) => words.every((w) => e.segment.name.toLowerCase().includes(w)))
      .sort((a, b) => a.segment.name.localeCompare(b.segment.name));
  }
  async save(entry: SegmentEntry, replace = false) {
    const validated = segmentEntry(entry);
    let size = 0;
    for (const r of validated.segment.resources) {
      const file = validated.resources[r.path];
      if (file?.state !== "available")
        throw new Error("Segment resource is missing. Relink it first.");
      size += file.file.size;
    }
    if (size > 256 * 1024 * 1024) throw new Error("Saved segment exceeds 256 MiB.");
    const previous =
      (
        await this.db.request({ type: "read", collection: "segments", key: validated.segment.id })
      )[0]?.value ?? null;
    if (previous !== null && !replace)
      throw new QueryError(
        "badRequest",
        "A segment with that name already exists. Use replace to replace it.",
      );
    await this.db.request({
      type: "commit",
      checks: [{ collection: "segments", key: validated.segment.id, value: previous }],
      writes: [
        {
          collection: "segments",
          key: validated.segment.id,
          value: await encodeStored(validated, this.db),
        },
      ],
    });
  }
  close() {
    /* Shared page connection. */
  }
}
