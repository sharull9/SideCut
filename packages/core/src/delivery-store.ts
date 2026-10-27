import { decodeDelivery, type Delivery } from "@sidecut/contracts/delivery";
import type { StorageRequest, StorageRow } from "@sidecut/contracts/storage";

export class DeliveryStore {
  constructor(
    private readonly storage: {
      request: (request: StorageRequest) => Promise<readonly StorageRow[]>;
    },
  ) {}
  async list(): Promise<Delivery[]> {
    return (await this.storage.request({ type: "read", collection: "deliveries" })).map((row) => {
      const entry = decodeDelivery(JSON.parse(row.value));
      if (entry.id !== row.key) throw new Error("Delivery ID does not match its stored key.");
      return entry;
    });
  }
  async put(entry: Delivery, expected: Delivery | null) {
    entry = decodeDelivery(entry);
    if (expected) expected = decodeDelivery(expected);
    if (
      expected &&
      (expected.id !== entry.id || JSON.stringify(expected.recipe) !== JSON.stringify(entry.recipe))
    )
      throw new Error("Delivery identity and recipe cannot change.");
    await this.storage.request({
      type: "commit",
      checks: [
        {
          collection: "deliveries",
          key: entry.id,
          value: expected ? JSON.stringify(expected) : null,
        },
      ],
      writes: [{ collection: "deliveries", key: entry.id, value: JSON.stringify(entry) }],
    });
  }
  async remove(entry: Delivery) {
    await this.storage.request({
      type: "commit",
      checks: [{ collection: "deliveries", key: entry.id, value: JSON.stringify(entry) }],
      writes: [{ collection: "deliveries", key: entry.id, value: null }],
    });
  }
  async interruptRunning() {
    const entries = await this.list();
    for (const entry of entries)
      if (entry.status === "running") await this.put({ ...entry, status: "interrupted" }, entry);
    return this.list();
  }
}
