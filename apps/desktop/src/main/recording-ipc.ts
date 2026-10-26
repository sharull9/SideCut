import { BrowserWindow, dialog, ipcMain } from "electron";
import type { IpcMainInvokeEvent } from "electron";
import { RecordingStore } from "@sidecut/core/recordings";
import type { NativeStorage } from "./sqlite-storage";
import { exportSavedRecording } from "./recording-output";
import { bridgeChannels } from "../shared/bridge";

export function registerRecordingStorage(
  storage: NativeStorage,
  isTrusted: (url: string) => boolean,
) {
  const directories = new Map<number, string>(),
    running = new Map<number, AbortController>();
  const check = (event: IpcMainInvokeEvent) => {
    if (
      !event.senderFrame ||
      event.senderFrame !== event.sender.mainFrame ||
      !isTrusted(event.senderFrame.url)
    )
      throw new Error("Untrusted recording storage sender.");
  };
  ipcMain.handle(bridgeChannels.recordingDirectory, async (event) => {
    check(event);
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) throw new Error("Recording window is closed.");
    const choice = await dialog.showOpenDialog(window, {
      properties: ["openDirectory", "createDirectory"],
      title: "Save recordings in a folder",
    });
    if (choice.canceled || !choice.filePaths[0]) return false;
    directories.set(event.sender.id, choice.filePaths[0]);
    event.sender.once("destroyed", () => {
      directories.delete(event.sender.id);
      running.get(event.sender.id)?.abort();
    });
    return true;
  });
  ipcMain.handle(bridgeChannels.recordingExport, async (event, id: unknown) => {
    check(event);
    if (typeof id !== "string" || !/^[a-f0-9-]{36}$/.test(id))
      throw new Error("Invalid recording ID.");
    const directory = directories.get(event.sender.id);
    if (!directory) throw new Error("Choose a recording output folder first.");
    if (running.has(event.sender.id)) throw new Error("A recording export is already running.");
    const controller = new AbortController();
    running.set(event.sender.id, controller);
    const stop = () => controller.abort();
    event.sender.once("destroyed", stop);
    try {
      return await exportSavedRecording(
        new RecordingStore(storage),
        id,
        directory,
        controller.signal,
      );
    } finally {
      running.delete(event.sender.id);
      event.sender.removeListener("destroyed", stop);
    }
  });
}
