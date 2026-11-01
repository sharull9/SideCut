import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve as resolvePath } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { request as httpsRequest } from "node:https";
import { generateKeyPairSync, sign } from "node:crypto";
import type { NativeRecording } from "@sidecut/contracts/native-recording";
import { SideCutClient } from "../../../../packages/client/src/index";
import { signedIntent, type RemoteIntent, type remoteState } from "@sidecut/core/remote-control";
import { HostProjectService } from "./project-service.ts";
import { NativeProjectStore } from "./project-store.ts";
import { ProjectAPI } from "./project-api.ts";
import { LocalHTTPService } from "./http-service.ts";
import { RemoteControlAuthority, remoteStudioRunner } from "./remote-control.ts";
import { RemoteControlServer } from "./remote-control-server.ts";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const cleanup of cleanups.reverse().splice(0)) await cleanup();
});
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "sidecut-studio-control-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const host = new HostProjectService(new NativeProjectStore(join(root, "project.tandem")));
  await host.start();
  cleanups.push(() => host.close());
  const api = new ProjectAPI(host);
  const server = new LocalHTTPService(api);
  const address = await server.start();
  cleanups.push(() => server.close());
  const client = new SideCutClient(address, fetch, "studio-test");
  const revision = JSON.parse(host.snapshot().json).revision;
  return { root, host, api, address, client, revision };
}

describe("studio automation through host adapters", () => {
  it("persists scene changes, guards revisions, replays keys and exposes SDK/CLI/MCP actions", async () => {
    const { root, host, api, address, client, revision } = await setup();
    const save = {
      action: "save",
      id: "scene",
      name: "Scene",
      expectedRevision: revision,
      studioRevision: 0,
      idempotencyKey: "save-scene",
    };
    expect(await client.studio(save)).toMatchObject({ revision: revision + 1, studioRevision: 1 });
    expect(await client.studio(save)).toMatchObject({ replayed: true, studioRevision: 1 });
    await expect(client.studio({ ...save, name: "Conflict" })).rejects.toThrow(/conflicts/);
    await expect(client.studio({ ...save, idempotencyKey: "stale" })).rejects.toThrow(/changed/);
    expect(
      await client.studio({
        ...save,
        action: "switch",
        expectedRevision: revision + 1,
        studioRevision: 1,
        idempotencyKey: "switch-scene",
      }),
    ).toMatchObject({ activeSceneID: "scene", revision: revision + 2 });
    const endpoint = join(root, "endpoint.json");
    await writeFile(endpoint, JSON.stringify(address));
    const { stdout } = await promisify(execFile)(
      process.execPath,
      [
        resolvePath("scripts/sidecut-cli.mjs"),
        "studio",
        "--action",
        "status",
        "--endpoint-file",
        endpoint,
        "--json",
      ],
      { windowsHide: true },
    );
    expect(JSON.parse(stdout)).toMatchObject({ activeSceneID: "scene", studioRevision: 2 });
    const adapters = await import("../../../../scripts/mcp-adapters.mjs");
    expect(adapters.prepareTool("studio", { action: "status" }).tool.operation).toBe("studio");
    expect(() => adapters.prepareTool("studio", { action: "start-recording" })).toThrow();
    await host.flush();
    const persisted = await host.store.load(() => {
      throw new Error("Missing persisted project");
    });
    const savedStudio = persisted.project.metadata["sidecut.liveStudio"];
    if (!savedStudio) throw new Error("Missing persisted studio state");
    expect(JSON.parse(savedStudio).active.id).toBe("scene");
    expect(await api.handle("undo", { expectedRevision: revision + 2 })).toBeTruthy();
    expect(await client.studio({ action: "status" })).toMatchObject({
      activeSceneID: null,
      studioRevision: 1,
    });
  }, 15000);
  it("stops only the identified recording, reports confirmed status and emits an authored event", async () => {
    const { host, revision } = await setup();
    let recording: NativeRecording = {
      id: "recording",
      projectID: JSON.parse(host.snapshot().json).project.id,
      source: "camera",
      createdAt: new Date().toISOString(),
      status: "recording",
      encoder: "libx264",
      elapsedSeconds: 1,
      bytes: 100,
      tracks: [],
      error: null,
    };
    const recorder = {
      list: vi.fn(async () => [recording]),
      stop: vi.fn(async () => {
        recording = { ...recording, status: "ready" };
        return recording;
      }),
      streamStatus: () => ({ state: "off" as const }),
    };
    const api = new ProjectAPI(host, undefined, undefined, recorder);
    const request = {
      action: "recording-stop",
      id: "recording",
      expectedRevision: revision,
      studioRevision: 0,
      idempotencyKey: "stop",
      author: "deck",
    };
    await expect(api.handle("studio", { ...request, id: "wrong" })).rejects.toThrow(/unavailable/);
    expect(await api.handle("studio", request)).toMatchObject({
      recording: { id: "recording", status: "ready" },
    });
    expect(await api.handle("studio", request)).toMatchObject({ replayed: true });
    expect(recorder.stop).toHaveBeenCalledExactlyOnceWith("recording");
    const events: unknown[] = [];
    const stop = api.events.subscribe(0, (event) => events.push(event));
    stop();
    expect(events[0]).toMatchObject({
      kind: "studio",
      author: "deck",
      studio: { id: "recording" },
    });
  });
  it("refuses arbitrary fields and cancelled work without changing a project", async () => {
    const { api, host } = await setup();
    const before = host.snapshot().json;
    await expect(api.handle("studio", { action: "status", streamKey: "secret" })).rejects.toThrow();
    const controller = new AbortController();
    controller.abort();
    await expect(
      api.handle(
        "studio",
        {
          action: "save",
          id: "x",
          expectedRevision: 0,
          studioRevision: 0,
          idempotencyKey: "cancelled",
        },
        controller.signal,
      ),
    ).rejects.toThrow();
    expect(host.snapshot().json).toBe(before);
  });
});

const reduced = { revision: 0, studioRevision: 0, activeSceneID: null, recording: null };
async function paired(
  run: (
    intent: RemoteIntent,
    signal: AbortSignal,
  ) => Promise<ReturnType<typeof remoteState>> = vi.fn(async () => reduced),
) {
  const authority = new RemoteControlAuthority(run, async () => true);
  cleanups.push(async () => authority.close());
  const keys = generateKeyPairSync("ed25519");
  const pairing = authority.beginPairing();
  const publicKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
  const device = await authority.pair({ ...pairing, name: "Phone", publicKey });
  const intent = {
    deviceID: device.id,
    requestID: "intent-1",
    sequence: 1,
    expiresAt: Date.now() + 10000,
    action: "status",
    id: "",
    revision: 0,
    studioRevision: 0,
  } as const;
  const signature = (value: RemoteIntent = intent) =>
    sign(null, Buffer.from(signedIntent(value)), keys.privateKey).toString("base64url");
  return { authority, keys, publicKey, pairing, device, intent, signature, run };
}

describe("restricted phone/deck authority", () => {
  it("uses one-time approved pairing and Ed25519 signatures with expiry and replay rejection", async () => {
    const { authority, intent, signature, pairing, publicKey, run } = await paired();
    await expect(authority.pair({ ...pairing, name: "Replay", publicKey })).rejects.toThrow(
      /expired|unavailable/,
    );
    await expect(
      authority.execute({ ...intent, action: "recording-stop" }, signature()),
    ).rejects.toThrow(/authorization/);
    expect(await authority.execute(intent, signature())).toMatchObject({
      confirmed: true,
      state: reduced,
    });
    await expect(authority.execute(intent, signature())).rejects.toThrow(/replayed/);
    const expired = { ...intent, sequence: 2, expiresAt: Date.now() - 1 };
    await expect(authority.execute(expired, signature(expired))).rejects.toThrow(/Expired/);
    await expect(
      authority.execute({ ...intent, operation: "apply" }, signature()),
    ).rejects.toThrow();
    expect(run).toHaveBeenCalledOnce();
  });
  it("aborts an in-flight device action on revoke and prevents later calls", async () => {
    let finish!: () => void;
    let signal!: AbortSignal;
    const run = vi.fn(async (_intent, inputSignal: AbortSignal) => {
      signal = inputSignal;
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return reduced;
    });
    const { authority, device, intent, signature } = await paired(run);
    const pending = authority.execute(intent, signature());
    authority.revoke(device.id);
    expect(signal.aborted).toBe(true);
    finish();
    await expect(pending).rejects.toThrow();
    await expect(authority.execute(intent, signature())).rejects.toThrow(/authorization/);
    expect(authority.list()).toEqual([]);
  });
  it("bounds signed request rates and aborts pending pairing when the authority closes", async () => {
    const { authority, intent, signature } = await paired();
    for (let sequence = 1; sequence <= 60; sequence++) {
      const next = { ...intent, sequence };
      await authority.execute(next, signature(next));
    }
    const limited = { ...intent, sequence: 61 };
    await expect(authority.execute(limited, signature(limited))).rejects.toThrow(/rate limit/);
    const pendingAuthority = new RemoteControlAuthority(
      async () => reduced,
      () => new Promise(() => {}),
    );
    const keys = generateKeyPairSync("ed25519");
    const pending = pendingAuthority.pair({
      ...pendingAuthority.beginPairing(),
      name: "Pending",
      publicKey: keys.publicKey.export({ type: "spki", format: "pem" }).toString(),
    });
    pendingAuthority.close();
    await expect(pending).rejects.toThrow();
    expect(() => pendingAuthority.beginPairing()).toThrow();
    expect(pendingAuthority.list()).toEqual([]);
  });
  it("returns confirmed reduced state after a real studio switch", async () => {
    const { api, revision } = await setup();
    await api.handle("studio", {
      action: "save",
      id: "one",
      expectedRevision: revision,
      studioRevision: 0,
      idempotencyKey: "save",
    });
    const authority = new RemoteControlAuthority(remoteStudioRunner(api), async () => true);
    cleanups.push(async () => authority.close());
    const keys = generateKeyPairSync("ed25519");
    const pairing = authority.beginPairing();
    const device = await authority.pair({
      ...pairing,
      name: "Deck",
      publicKey: keys.publicKey.export({ type: "spki", format: "pem" }).toString(),
    });
    const intent = {
      deviceID: device.id,
      requestID: "switch",
      sequence: 1,
      expiresAt: Date.now() + 10000,
      action: "scene-switch",
      id: "one",
      revision: revision + 1,
      studioRevision: 1,
    } as const;
    const result = await authority.execute(
      intent,
      sign(null, Buffer.from(signedIntent(intent)), keys.privateKey).toString("base64url"),
    );
    expect(result.state).toEqual({
      revision: revision + 2,
      studioRevision: 2,
      activeSceneID: "one",
      recording: null,
    });
    expect(JSON.stringify(result)).not.toMatch(/metadata|snapshot|streamURL|sourcePath|token/);
  });
  it("runs a separate trusted TLS listener and never serves the general local API", async () => {
    const { authority, intent, signature } = await paired();
    const cert = await readFile(resolvePath("tests/fixtures/streaming/localhost-cert.pem"));
    const key = await readFile(resolvePath("tests/fixtures/streaming/localhost-key.pem"));
    expect(() => new RemoteControlServer(authority, "0.0.0.0", { cert, key })).toThrow(
      /private LAN/,
    );
    const server = new RemoteControlServer(authority, "127.0.0.1", { cert, key });
    const { port } = await server.start();
    cleanups.push(() => server.close());
    const post = (path: string, body: unknown, origin?: string) =>
      new Promise<{ status: number; body: string }>((resolve, reject) => {
        const request = httpsRequest(
          {
            hostname: "127.0.0.1",
            port,
            path,
            method: "POST",
            ca: cert,
            headers: { "content-type": "application/json", ...(origin ? { origin } : {}) },
          },
          (response) => {
            let responseText = "";
            response.on("data", (chunk) => {
              responseText += chunk;
            });
            response.on("end", () => resolve({ status: response.statusCode!, body: responseText }));
          },
        );
        request.on("error", reject);
        request.end(JSON.stringify(body));
      });
    expect((await post("/v1/apply", {})).status).toBe(404);
    expect(
      (await post("/intent", { intent, signature: signature() }, "https://untrusted.test")).status,
    ).toBe(403);
    const result = await post("/intent", { intent, signature: signature() });
    expect(result.status).toBe(200);
    expect(JSON.parse(result.body).confirmed).toBe(true);
    expect((await post("/intent", { intent, signature: signature() })).status).toBe(403);
  });
});
