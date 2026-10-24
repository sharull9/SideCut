import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request as httpRequest } from "node:http";
import { HostProjectService } from "./project-service.ts";
import { NativeProjectStore } from "./project-store.ts";
import { ProjectAPI } from "./project-api.ts";
import { LocalHTTPService } from "./http-service.ts";
import type { NativeMedia } from "./native-media.ts";
import fixture from "../../../../tests/fixtures/tandem/project-queries.json";

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of cleanup.reverse().splice(0)) await close();
});
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "sidecut-api-test-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const host = new HostProjectService(new NativeProjectStore(join(root, "current.tandem")));
  await host.start();
  cleanup.push(() => host.close());
  await host.replace(JSON.stringify(fixture.project));
  const probe = vi.fn<NativeMedia["run"]>(async () =>
    new TextEncoder().encode(
      JSON.stringify({ format: { duration: "2" }, streams: [{ codec_type: "audio" }] }),
    ),
  );
  const api = new ProjectAPI(host, { run: probe });
  const server = new LocalHTTPService(api),
    address = await server.start();
  cleanup.push(() => server.close());
  const url = `http://127.0.0.1:${address.port}/v1/`;
  const call = (
    op: string,
    body: unknown = {},
    headers: Record<string, string> = {},
    signal?: AbortSignal,
  ) =>
    fetch(url + op, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${address.token}`,
        "Content-Type": "application/json",
        ...headers,
      },
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    });
  return { root, host, api, call, url, probe };
}
describe("authenticated loopback project service", () => {
  it("cancels a disconnected refresh without committing its media", async () => {
    const { root, host, api, call, probe } = await setup();
    await writeFile(join(root, "cancel.wav"), "synthetic");
    api.setMediaRoot(root);
    let started!: () => void, stopped!: () => void;
    const began = new Promise<void>((resolve) => {
      started = resolve;
    });
    const cancelled = new Promise<void>((resolve) => {
      stopped = resolve;
    });
    probe.mockImplementationOnce(
      (_operation, _bytes, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => {
              stopped();
              reject(new Error("Cancelled"));
            },
            { once: true },
          );
          started();
        }),
    );
    const controller = new AbortController();
    const result = call("media", { refresh: true }, {}, controller.signal).catch(() => null);
    await began;
    controller.abort();
    await cancelled;
    await result;
    expect(JSON.parse(host.snapshot().json).revision).toBe(0);
  });
  it("matches pinned query envelopes and reads the same renderer revision", async () => {
    const { host, call } = await setup();
    expect(await (await call("status")).json()).toMatchObject(fixture.status.result);
    expect(await (await call("clips", fixture.clips.request)).json()).toEqual(fixture.clips.result);
    expect(await (await call("media")).json()).toMatchObject({
      revision: 0,
      added: [],
      items: [fixture.media.item],
    });
    expect((await call("timeline", fixture.timeline.failure)).status).toBe(400);
    expect((await call("clips", fixture.clips.failure)).status).toBe(404);
    const snapshot = host.snapshot();
    host.request(
      JSON.stringify({
        type: "apply",
        projectID: fixture.project.project.id,
        generation: snapshot.generation,
        batch: {
          expectedRevision: 0,
          commands: [{ updateProject: { patch: { name: "Renderer edit" } } }],
        },
      }),
    );
    expect(await (await call("status")).json()).toMatchObject({
      name: "Renderer edit",
      revision: 1,
      undo: "Edit",
    });
  });
  it("rejects wrong tokens, origins, hosts, malformed bodies and filesystem fields", async () => {
    const { call, url, host } = await setup();
    expect((await fetch(url + "health")).status).toBe(200);
    expect((await fetch(url + "status")).status).toBe(401);
    expect((await call("status", {}, { Authorization: "Bearer wrong" })).status).toBe(401);
    expect(
      (await call("media", { refresh: true }, { Origin: "https://unrelated.example" })).status,
    ).toBe(403);
    const badHost = await new Promise<number | undefined>((resolve, reject) => {
      const req = httpRequest(
        url + "status",
        { headers: { Host: "attacker.example" } },
        (response) => {
          response.resume();
          resolve(response.statusCode);
        },
      );
      req.on("error", reject);
      req.end();
    });
    expect(badHost).toBe(403);
    expect((await call("status", fixture.status.failure)).status).toBe(400);
    expect((await call("media", fixture.media.failure)).status).toBe(400);
    expect((await call("export", { output: "../outside" })).status).toBe(400);
    expect((await call("status", [])).status).toBe(400);
    expect((await call("status", { large: "x".repeat(2 * 1024 * 1024) })).status).toBe(413);
    expect(JSON.parse(host.snapshot().json).revision).toBe(0);
  });
  it("refreshes media once through shared history, and does not commit failed or stale scans", async () => {
    const { root, host, api, call, probe } = await setup();
    expect((await call("media", { refresh: true })).status).toBe(503);
    await writeFile(join(root, "speech.wav"), "synthetic");
    api.setMediaRoot(root);
    const result = await (await call("media", { refresh: true })).json();
    expect(result).toMatchObject({ added: [expect.any(String)], revision: 1 });
    expect(await (await call("media", { refresh: true })).json()).toMatchObject({ added: [] });
    const snapshot = host.snapshot();
    host.request(
      JSON.stringify({
        type: "undo",
        projectID: fixture.project.project.id,
        generation: snapshot.generation,
        revision: 1,
      }),
    );
    expect(await (await call("media")).json()).toMatchObject({
      items: [expect.objectContaining({ id: "med_query" })],
    });
    probe.mockRejectedValueOnce(new Error("Cannot probe source"));
    expect((await call("media", { refresh: true })).status).toBe(400);
    expect(JSON.parse(host.snapshot().json).revision).toBe(2);
    probe.mockImplementationOnce(async () => {
      await host.replace(JSON.stringify(fixture.project));
      return new TextEncoder().encode('{"streams":[{"codec_type":"audio"}]}');
    });
    expect((await call("media", { refresh: true })).status).toBe(400);
    expect(JSON.parse(host.snapshot().json).revision).toBe(0);
  });
});
