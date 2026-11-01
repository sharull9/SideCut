/* eslint-disable typescript/no-explicit-any -- Electron boundary mocks have partial shapes. */
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const electron = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  request: undefined as any,
  display: undefined as any,
  dialog: vi.fn(),
  sources: vi.fn(),
  contents: undefined as any,
}));
vi.mock("electron", () => ({
  BrowserWindow: { fromWebContents: () => ({}) },
  desktopCapturer: { getSources: electron.sources },
  dialog: { showMessageBox: electron.dialog },
  ipcMain: {
    handle: (name: string, handler: (...args: any[]) => any) =>
      electron.handlers.set(name, handler),
  },
  session: {
    defaultSession: {
      setPermissionRequestHandler: (handler: any) => {
        electron.request = handler;
      },
      setPermissionCheckHandler: () => {},
      setDisplayMediaRequestHandler: (handler: any) => {
        electron.display = handler;
      },
    },
  },
  systemPreferences: { getMediaAccessStatus: () => "granted" },
  webContents: { fromFrame: () => electron.contents },
}));
import { registerCapturePermissions } from "./capture-permissions";
import { bridgeChannels } from "../shared/bridge";

const id = "00000000-0000-0000-0000-000000000000";
let contents: EventEmitter & {
  id: number;
  mainFrame: { url: string };
  getURL: () => string;
  isDestroyed: () => boolean;
};
let event: { sender: typeof contents; senderFrame: typeof contents.mainFrame };
const prepare = (source: string, microphone = false) =>
  electron.handlers.get(bridgeChannels.capturePrepare)!(event, id, { source, microphone });
const allowAudio = () => {
  let allowed = false;
  electron.request(
    contents,
    "media",
    (value: boolean) => {
      allowed = value;
    },
    { isMainFrame: true, requestingUrl: "trusted", mediaTypes: ["audio"] },
  );
  return allowed;
};
beforeEach(() => {
  vi.useFakeTimers();
  electron.handlers.clear();
  electron.dialog.mockReset().mockResolvedValue({ response: 1 });
  electron.sources.mockReset().mockResolvedValue([{ id: "screen:1", name: "Screen" }]);
  contents = Object.assign(new EventEmitter(), {
    id: 1,
    mainFrame: { url: "trusted" },
    getURL: () => "trusted",
    isDestroyed: () => false,
  });
  event = { sender: contents, senderFrame: contents.mainFrame };
  electron.contents = contents;
  registerCapturePermissions((url) => url === "trusted");
});
afterEach(() => {
  vi.useRealTimers();
});

it("expires stalled approval and rejects its late response", async () => {
  let answer!: (value: { response: number }) => void;
  electron.dialog.mockImplementation(
    () =>
      new Promise((resolve) => {
        answer = resolve;
      }),
  );
  const pending = prepare("microphone");
  vi.advanceTimersByTime(60_000);
  answer({ response: 1 });
  await expect(pending).rejects.toThrow("expired");
  expect(allowAudio()).toBe(false);
});

it("revokes on crash and rejects a replacement document", async () => {
  await prepare("microphone");
  expect(allowAudio()).toBe(true);
  contents.mainFrame = { url: "trusted" };
  expect(allowAudio()).toBe(false);
  contents.emit("render-process-gone");
  event.senderFrame = contents.mainFrame;
  await prepare("microphone");
  expect(allowAudio()).toBe(true);
});

it("expires an approved grant relative to approval", async () => {
  let answer!: (value: { response: number }) => void;
  electron.dialog.mockImplementation(
    () =>
      new Promise((resolve) => {
        answer = resolve;
      }),
  );
  const pending = prepare("microphone");
  vi.advanceTimersByTime(50_000);
  answer({ response: 1 });
  await pending;
  vi.advanceTimersByTime(309_999);
  expect(allowAudio()).toBe(true);
  vi.advanceTimersByTime(1);
  expect(allowAudio()).toBe(false);
});

it("requires screen consent before audio and accepts only one display request", async () => {
  await prepare("screen", true);
  expect(allowAudio()).toBe(false);
  const request = {
    frame: contents.mainFrame,
    securityOrigin: "trusted",
    videoRequested: true,
    audioRequested: false,
  };
  const display = () => new Promise<any>((resolve) => electron.display(request, resolve));
  const first = display();
  expect(await display()).toEqual({});
  expect((await first).video.id).toBe("screen:1");
  expect(allowAudio()).toBe(true);
  expect(await display()).toEqual({});
});
