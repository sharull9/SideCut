import { BrowserWindow, dialog, ipcMain, shell } from "electron";
import type { IpcMainInvokeEvent } from "electron";
import { bridgeChannels } from "../shared/bridge.ts";
import type { NativeRecordingLibrary } from "./native-recording-library.ts";

export function registerNativeRecordingLibrary(
  library: NativeRecordingLibrary,
  isTrusted: (url: string) => boolean,
  headless: boolean,
) {
  const check = (event: IpcMainInvokeEvent, args: unknown[]) => {
    if (
      headless ||
      !event.senderFrame ||
      event.senderFrame !== event.sender.mainFrame ||
      event.sender.isDestroyed() ||
      !isTrusted(event.senderFrame.url)
    )
      throw new Error("Untrusted native recording sender.");
    const [id] = args;
    if (
      args.length !== 1 ||
      typeof id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
    )
      throw new Error("Invalid recording ID.");
    return { id, frame: event.senderFrame };
  };
  ipcMain.handle(bridgeChannels.nativeRecordingPoster, (event, ...args: unknown[]) =>
    library.poster(check(event, args).id),
  );
  ipcMain.handle(bridgeChannels.nativeRecordingAdopt, (event, ...args: unknown[]) =>
    library.adopt(check(event, args).id),
  );
  ipcMain.handle(bridgeChannels.nativeRecordingRead, (event, ...args: unknown[]) =>
    library.read(check(event, args).id),
  );
  ipcMain.handle(bridgeChannels.nativeRecordingReveal, (event, ...args: unknown[]) =>
    library.reveal(check(event, args).id, (path) => shell.showItemInFolder(path)),
  );
  ipcMain.handle(bridgeChannels.nativeRecordingDelete, async (event, ...args: unknown[]) => {
    const { id, frame } = check(event, args);
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window || !window.isVisible()) throw new Error("A visible recording window is required.");
    let invalid = false;
    const revoke = () => {
      invalid = true;
    };
    const navigated = (_event: unknown, _url: string, _inPlace: boolean, main: boolean) => {
      if (main) revoke();
    };
    event.sender.on("did-start-navigation", navigated);
    event.sender.once("destroyed", revoke);
    event.sender.once("render-process-gone", revoke);
    try {
      const choice = await dialog.showMessageBox(window, {
        type: "question",
        title: "Delete recording",
        message: `Delete Recording-${id}.mp4?`,
        detail: "This permanently removes the recording from this device.",
        buttons: ["Cancel", "Delete"],
        defaultId: 0,
        cancelId: 0,
      });
      if (choice.response !== 1) throw new Error("Recording deletion cancelled.");
      if (
        invalid ||
        event.sender.isDestroyed() ||
        event.sender.mainFrame !== frame ||
        !isTrusted(frame.url) ||
        !window.isVisible()
      )
        throw new Error("Recording deletion request expired.");
      await library.remove(id);
    } finally {
      event.sender.removeListener("did-start-navigation", navigated);
      event.sender.removeListener("destroyed", revoke);
      event.sender.removeListener("render-process-gone", revoke);
    }
  });
}
