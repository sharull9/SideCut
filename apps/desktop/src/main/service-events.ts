export type ServiceEvent = {
  seq: number;
  kind: "edit" | "undo" | "redo" | "reload" | "jobs" | "export";
  date: string;
  revision?: number;
  label?: string;
  author?: string;
  jobs?: unknown[];
  export?: Record<string, unknown>;
};
export class ServiceEvents {
  private sequence = 0;
  private buffer: ServiceEvent[] = [];
  private listeners = new Set<(event: ServiceEvent) => void>();
  get lastSeq() {
    return this.sequence;
  }
  get subscriberCount() {
    return this.listeners.size;
  }
  publish(value: Omit<ServiceEvent, "seq" | "date">) {
    const event = { ...value, seq: ++this.sequence, date: new Date().toISOString() };
    this.buffer.push(event);
    if (this.buffer.length > 500) this.buffer.shift();
    for (const listener of this.listeners) listener(event);
    return event;
  }
  subscribe(after: number | undefined, listener: (event: ServiceEvent) => void) {
    if (after !== undefined)
      for (const event of this.buffer) if (event.seq > after) listener(event);
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
