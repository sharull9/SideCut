import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { beforeEach, expect, it, vi } from "vite-plus/test";
const mock = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
}));
vi.mock("electron", () => ({
  app: { isPackaged: false },
  BrowserWindow: { getAllWindows: () => [] },
  dialog: {},
  ipcMain: {
    on: () => {},
    handle: (name: string, handler: (...args: unknown[]) => unknown) =>
      mock.handlers.set(name, handler),
  },
}));
import { registerNativeIPC } from "./native-ipc.ts";
import { HostProjectService } from "./project-service.ts";
import { NativeProjectStore } from "./project-store.ts";
import { ProjectAPI } from "./project-api.ts";
import { bridgeChannels } from "../shared/bridge.ts";

beforeEach(() => mock.handlers.clear());

it("returns only the support report through a trusted no-argument IPC call", async () => {
  const root = await mkdtemp(join(tmpdir(), "sidecut-support-ipc-"));
  const host = new HostProjectService(new NativeProjectStore(join(root, "private-project.tandem")));
  await host.start();
  const close = registerNativeIPC(host, (url) => url === "trusted", new ProjectAPI(host));
  try {
    const handler = mock.handlers.get(bridgeChannels.supportReport);
    assert.ok(handler);
    const frame = { url: "trusted" },
      sender = { mainFrame: frame, isDestroyed: () => false },
      event = { senderFrame: frame, sender };
    const before = host.snapshot().json,
      files = (await readdir(root)).sort();
    const text = await handler(event);
    assert.ok(typeof text === "string");
    const report = JSON.parse(text);
    expect(report).toMatchObject({ format: "sidecut-support", version: 1 });
    expect(report).not.toHaveProperty("output");
    expect(report).not.toHaveProperty("report");
    expect(text).not.toContain(root);
    expect(text).not.toContain("private-project.tandem");
    expect(host.snapshot().json).toBe(before);
    expect((await readdir(root)).sort()).toEqual(files);
    await expect(handler(event, { output: "outside.json" })).rejects.toThrow(/arguments/);
    await expect(handler({ ...event, senderFrame: { url: "trusted" } })).rejects.toThrow(
      /Untrusted/,
    );
    await expect(handler({ ...event, senderFrame: null })).rejects.toThrow(/Untrusted/);
    await expect(
      handler({ senderFrame: frame, sender: { mainFrame: frame, isDestroyed: () => true } }),
    ).rejects.toThrow(/Untrusted/);
    const outside = { url: "https://untrusted.test" };
    await expect(
      handler({ senderFrame: outside, sender: { ...sender, mainFrame: outside } }),
    ).rejects.toThrow(/Untrusted/);
    const navigated = handler(event);
    frame.url = "https://untrusted.test";
    await expect(navigated).rejects.toThrow(/Untrusted/);
    frame.url = "trusted";
    const destroyed = handler(event);
    sender.isDestroyed = () => true;
    await expect(destroyed).rejects.toThrow(/Untrusted/);
  } finally {
    await close();
    assert.ok(root.startsWith(join(tmpdir(), "sidecut-support-ipc-")));
    await rm(root, { recursive: true, force: true });
  }
});

it("refuses the report when the host API is unavailable", async () => {
  const root = await mkdtemp(join(tmpdir(), "sidecut-support-ipc-"));
  const host = new HostProjectService(new NativeProjectStore(join(root, "project.tandem")));
  await host.start();
  const close = registerNativeIPC(host, () => true);
  try {
    const handler = mock.handlers.get(bridgeChannels.supportReport);
    assert.ok(handler);
    const frame = { url: "trusted" };
    await expect(
      handler({ senderFrame: frame, sender: { mainFrame: frame, isDestroyed: () => false } }),
    ).rejects.toThrow(/unavailable/);
  } finally {
    await close();
    assert.ok(root.startsWith(join(tmpdir(), "sidecut-support-ipc-")));
    await rm(root, { recursive: true, force: true });
  }
});
