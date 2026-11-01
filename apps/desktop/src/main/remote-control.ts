import {
  randomBytes,
  randomUUID,
  timingSafeEqual,
  createPublicKey,
  createHash,
  verify,
  type KeyObject,
} from "node:crypto";
import {
  remoteIntent,
  remoteState,
  signedIntent,
  type RemoteIntent,
} from "@sidecut/core/remote-control";
import { object } from "@sidecut/core/interchange";
import type { ProjectAPI } from "./project-api.ts";

type Device = {
  id: string;
  name: string;
  key: KeyObject;
  sequence: number;
  requests: number[];
  controller: AbortController;
  busy: boolean;
};
type Runner = (
  intent: RemoteIntent,
  signal: AbortSignal,
) => Promise<ReturnType<typeof remoteState>>;

export class RemoteControlAuthority {
  private devices = new Map<string, Device>();
  private pairing: { code: string; expiresAt: number } | null = null;
  private generation = 0;
  private lifetime = new AbortController();
  constructor(
    private readonly run: Runner,
    private readonly approve: (
      device: { name: string; fingerprint: string },
      signal: AbortSignal,
    ) => Promise<boolean>,
  ) {}
  beginPairing() {
    this.lifetime.signal.throwIfAborted();
    const pairing = { code: randomBytes(32).toString("hex"), expiresAt: Date.now() + 60000 };
    this.pairing = pairing;
    return { ...pairing };
  }
  async pair(
    input: { code: string; name: string; publicKey: string },
    signal = new AbortController().signal,
  ) {
    const combined = AbortSignal.any([signal, this.lifetime.signal]);
    combined.throwIfAborted();
    if (
      typeof input.code !== "string" ||
      typeof input.name !== "string" ||
      !input.name.trim() ||
      input.name.length > 60 ||
      typeof input.publicKey !== "string" ||
      input.publicKey.length > 2048 ||
      !input.publicKey.startsWith("-----BEGIN PUBLIC KEY-----") ||
      !/^[a-f0-9]{64}$/.test(input.code)
    )
      throw new Error("Invalid pairing request.");
    const pairing = this.pairing;
    if (
      !pairing ||
      pairing.expiresAt <= Date.now() ||
      !timingSafeEqual(Buffer.from(pairing.code), Buffer.from(input.code))
    )
      throw new Error("Pairing expired or unavailable.");
    this.pairing = null;
    if (this.devices.size >= 16) throw new Error("Paired device limit reached.");
    const key = createPublicKey(input.publicKey);
    if (key.asymmetricKeyType !== "ed25519") throw new Error("An Ed25519 public key is required.");
    const fingerprint = createHash("sha256")
      .update(key.export({ type: "spki", format: "der" }))
      .digest("hex");
    const generation = this.generation;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let aborted = () => {};
    const approved = await Promise.race([
      this.approve({ name: input.name, fingerprint }, combined),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), 30000);
        aborted = () => resolve(false);
        combined.addEventListener("abort", aborted, { once: true });
        if (combined.aborted) aborted();
      }),
    ]).finally(() => {
      clearTimeout(timer);
      combined.removeEventListener("abort", aborted);
    });
    combined.throwIfAborted();
    if (!approved || generation !== this.generation || pairing.expiresAt <= Date.now())
      throw new Error("Pairing not approved.");
    const id = randomUUID();
    this.devices.set(id, {
      id,
      name: input.name,
      key,
      sequence: 0,
      requests: [],
      controller: new AbortController(),
      busy: false,
    });
    return { id, name: input.name };
  }
  list() {
    return [...this.devices.values()].map(({ id, name }) => ({ id, name }));
  }
  revoke(id: string) {
    this.devices.get(id)?.controller.abort();
    this.devices.delete(id);
  }
  close() {
    this.lifetime.abort();
    this.generation++;
    this.pairing = null;
    for (const device of this.devices.values()) device.controller.abort();
    this.devices.clear();
  }
  async execute(input: unknown, signature: unknown, signal = new AbortController().signal) {
    const intent = remoteIntent(input);
    if (typeof signature !== "string" || !/^[a-zA-Z0-9_-]{86}$/.test(signature))
      throw new Error("Invalid device signature.");
    const device = this.devices.get(intent.deviceID);
    if (
      !device ||
      !verify(
        null,
        Buffer.from(signedIntent(intent)),
        device.key,
        Buffer.from(signature, "base64url"),
      )
    )
      throw new Error("Device authorization denied.");
    const now = Date.now();
    if (
      intent.expiresAt <= now ||
      intent.expiresAt > now + 30000 ||
      intent.sequence <= device.sequence ||
      intent.sequence < 1
    )
      throw new Error("Expired or replayed intent.");
    device.requests = device.requests.filter((time) => time > now - 60000);
    if (device.busy || device.requests.length >= 60) throw new Error("Device rate limit.");
    const combined = AbortSignal.any([signal, device.controller.signal]);
    combined.throwIfAborted();
    device.sequence = intent.sequence;
    device.requests.push(now);
    device.busy = true;
    try {
      const result = remoteState(await this.run(intent, combined));
      combined.throwIfAborted();
      return { confirmed: true, requestID: intent.requestID, state: result };
    } finally {
      device.busy = false;
    }
  }
}

/** Never forward paths, media, keys or arbitrary ProjectAPI operations to a remote client. */
export function remoteStudioRunner(api: ProjectAPI): Runner {
  return async (intent, signal) => {
    const action = intent.action === "scene-switch" ? "switch" : intent.action;
    const state = object(
      await api.handle(
        "studio",
        action === "status"
          ? { action }
          : {
              action,
              id: intent.id,
              expectedRevision: intent.revision,
              studioRevision: intent.studioRevision,
              idempotencyKey: `remote:${intent.deviceID}:${intent.requestID}`,
              author: `remote:${intent.deviceID}`,
            },
        signal,
      ),
    );
    let recording: unknown = null;
    if (state.recording) recording = state.recording;
    return remoteState({
      revision: state.revision,
      studioRevision: state.studioRevision,
      activeSceneID: state.activeSceneID,
      recording,
    });
  };
}
