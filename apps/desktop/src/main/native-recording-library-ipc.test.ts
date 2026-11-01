/* eslint-disable typescript/no-explicit-any -- Partial Electron boundary mocks. */
import { EventEmitter } from "node:events";
import { beforeEach, expect, it, vi } from "vite-plus/test";
const mock = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  dialog: vi.fn(),
  show: vi.fn(),
}));
vi.mock("electron", () => ({
  BrowserWindow: { fromWebContents: () => ({ isVisible: () => true }) },
  dialog: { showMessageBox: mock.dialog },
  ipcMain: {
    handle: (name: string, handler: (...args: any[]) => any) => mock.handlers.set(name, handler),
  },
  shell: { showItemInFolder: mock.show },
}));
import { registerNativeRecordingLibrary } from "./native-recording-library-ipc.ts";
import { bridgeChannels } from "../shared/bridge.ts";

const id = "123e4567-e89b-42d3-a456-426614174000";
let sender: any;
let library: any;
beforeEach(() => {
  mock.handlers.clear();
  mock.dialog.mockReset();
  mock.show.mockReset();
  sender = Object.assign(new EventEmitter(), {
    mainFrame: { url: "trusted" },
    isDestroyed: () => false,
  });
  library = { poster: vi.fn(), read: vi.fn(), remove: vi.fn(), reveal: vi.fn() };
  registerNativeRecordingLibrary(library, (url) => url === "trusted", false);
});
it("rejects invalid arguments, untrusted frames and headless requests", async () => {
  for (const channel of [
    bridgeChannels.nativeRecordingPoster,
    bridgeChannels.nativeRecordingRead,
    bridgeChannels.nativeRecordingDelete,
    bridgeChannels.nativeRecordingReveal,
  ]) {
    const invoke = mock.handlers.get(channel)!;
    for (const args of [["../file"], [id, "extra"], [null]])
      await expect(
        Promise.resolve().then(() => invoke({ sender, senderFrame: sender.mainFrame }, ...args)),
      ).rejects.toThrow("Invalid recording ID");
    await expect(
      Promise.resolve().then(() => invoke({ sender, senderFrame: { url: "trusted" } }, id)),
    ).rejects.toThrow("Untrusted");
  }
  registerNativeRecordingLibrary(library, () => true, true);
  await expect(
    Promise.resolve().then(() =>
      mock.handlers.get(bridgeChannels.nativeRecordingRead)!(
        { sender, senderFrame: sender.mainFrame },
        id,
      ),
    ),
  ).rejects.toThrow("Untrusted");
});
it("cancels deletion and revokes confirmation on navigation or crash", async () => {
  const invoke = mock.handlers.get(bridgeChannels.nativeRecordingDelete)!;
  const event = { sender, senderFrame: sender.mainFrame };
  mock.dialog.mockResolvedValueOnce({ response: 0 });
  await expect(invoke(event, id)).rejects.toThrow("cancelled");
  for (const signal of ["did-start-navigation", "render-process-gone", "destroyed"]) {
    let answer!: (value: { response: number }) => void;
    mock.dialog.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    const pending = invoke(event, id);
    if (signal === "did-start-navigation") sender.emit(signal, {}, "trusted", false, true);
    else sender.emit(signal);
    answer({ response: 1 });
    await expect(pending).rejects.toThrow("expired");
  }
  expect(library.remove).not.toHaveBeenCalled();
  expect(mock.dialog.mock.calls[0]![1].message).toContain(id);
  expect(sender.listenerCount("did-start-navigation")).toBe(0);
});
it("deletes after confirmation and reveals only the library-resolved path", async () => {
  const event = { sender, senderFrame: sender.mainFrame };
  mock.dialog.mockResolvedValue({ response: 1 });
  await mock.handlers.get(bridgeChannels.nativeRecordingDelete)!(event, id);
  expect(library.remove).toHaveBeenCalledWith(id);
  library.reveal.mockImplementation((_id: string, show: (path: string) => void) =>
    show("owned/path"),
  );
  await mock.handlers.get(bridgeChannels.nativeRecordingReveal)!(event, id);
  expect(mock.show).toHaveBeenCalledWith("owned/path");
});
