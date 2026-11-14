/** R2 needs every part but the last to be the same size and at least 5 MiB. */
export const PART_BYTES = 8 * 1024 * 1024;
const ATTEMPTS = 4;

export type UploadProgress = { sentBytes: number; recordedBytes: number; parts: number };

export type CloudUploadTarget = {
  /** Signs a fresh URL for one part; signatures expire quickly, so each attempt asks again. */
  partUrl: (part: number) => Promise<string>;
  /** Sends one part. Rejects on network or HTTP failure. */
  put: (url: string, body: Blob) => Promise<void>;
  /** Fixes the final size, then asks storage to assemble the object. */
  finish: (expectedBytes: number, partCount: number) => Promise<void>;
  wait?: (ms: number) => Promise<void>;
};

/**
 * Uploads a recording while it is still being recorded. Chunks are buffered until a full part is
 * available, then sent in order, so memory stays near one part however long the take runs.
 */
export class RecordingUpload {
  #pending: Blob[] = [];
  #pendingBytes = 0;
  #recordedBytes = 0;
  #sentBytes = 0;
  #parts = 0;
  #queue: Promise<void> = Promise.resolve();
  #failure: unknown = null;
  #closed = false;
  readonly #target: CloudUploadTarget;
  readonly #onProgress: (progress: UploadProgress) => void;

  constructor(
    target: CloudUploadTarget,
    onProgress: (progress: UploadProgress) => void = () => {},
  ) {
    this.#target = target;
    this.#onProgress = onProgress;
  }

  get failed() {
    return this.#failure !== null;
  }

  push(chunk: Blob) {
    if (this.#closed) throw new Error("The upload is already finished.");
    if (!chunk.size) return;
    this.#pending.push(chunk);
    this.#pendingBytes += chunk.size;
    this.#recordedBytes += chunk.size;
    while (this.#pendingBytes >= PART_BYTES) this.#send(this.#take(PART_BYTES));
    this.#report();
  }

  /** Sends the remainder as the last part and completes the object. */
  async finish() {
    if (this.#closed) throw new Error("The upload is already finished.");
    this.#closed = true;
    if (this.#pendingBytes) this.#send(this.#take(this.#pendingBytes));
    await this.#queue;
    if (this.#failure) throw this.#failure;
    if (!this.#parts) throw new Error("The recording is empty.");
    await this.#target.finish(this.#recordedBytes, this.#parts);
  }

  #take(bytes: number) {
    const whole = new Blob(this.#pending);
    const part = whole.slice(0, bytes);
    const rest = whole.slice(bytes);
    this.#pending = rest.size ? [rest] : [];
    this.#pendingBytes = rest.size;
    return part;
  }

  #send(body: Blob) {
    const part = ++this.#parts;
    this.#queue = this.#queue.then(async () => {
      if (this.#failure) return;
      try {
        await this.#attempt(part, body);
        this.#sentBytes += body.size;
        this.#report();
      } catch (error) {
        this.#failure = error;
        this.#report();
      }
    });
  }

  async #attempt(part: number, body: Blob) {
    const wait = this.#target.wait ?? ((ms) => new Promise((done) => setTimeout(done, ms)));
    for (let attempt = 1; ; attempt++) {
      try {
        await this.#target.put(await this.#target.partUrl(part), body);
        return;
      } catch (error) {
        if (attempt >= ATTEMPTS) throw error;
        await wait(500 * 2 ** (attempt - 1));
      }
    }
  }

  #report() {
    this.#onProgress({
      sentBytes: this.#sentBytes,
      recordedBytes: this.#recordedBytes,
      parts: this.#parts,
    });
  }
}

export async function putPart(url: string, body: Blob) {
  const response = await fetch(url, { method: "PUT", body });
  if (!response.ok) throw new Error(`Cloud storage rejected a part (${response.status}).`);
}

export const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
