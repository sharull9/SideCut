import { BrowserWindow, dialog, ipcMain, systemPreferences } from "electron";
import type { IpcMainInvokeEvent } from "electron";
import type { NativeRecordingRequest } from "@sidecut/contracts/native-recording";
import { streamDestination } from "./native-streaming.ts";
import { bridgeChannels } from "../shared/bridge.ts";
import type { NativeRecorder } from "./native-recorder.ts";

export function registerNativeRecorder(
  recorder: NativeRecorder,
  isTrusted: (url: string) => boolean,
  headless: boolean,
) {
  let owner:
    | {
        sender: Electron.WebContents;
        frame: Electron.WebFrameMain;
        invalid: boolean;
        started: boolean;
        stopping: boolean;
        id: string | undefined;
        dispose: () => void;
      }
    | undefined;
  const check = (event: IpcMainInvokeEvent) => {
    if (
      headless ||
      !event.senderFrame ||
      event.senderFrame !== event.sender.mainFrame ||
      !isTrusted(event.senderFrame.url)
    )
      throw new Error("Untrusted native recording sender.");
    return event.senderFrame;
  };
  const valid = (event: IpcMainInvokeEvent, frame: Electron.WebFrameMain) =>
    !event.sender.isDestroyed() && event.sender.mainFrame === frame && isTrusted(frame.url);
  const parse = (value: unknown): NativeRecordingRequest => {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("Invalid native recording request.");
    const input = value as Record<string, unknown>;
    if (
      Object.keys(input).some(
        (key) =>
          !["projectID", "source", "deviceID", "microphoneID", "encoder", "streamURL"].includes(
            key,
          ),
      ) ||
      typeof input.projectID !== "string" ||
      !input.projectID.trim() ||
      input.projectID.length > 200 ||
      (input.source !== "screen" && input.source !== "camera" && input.source !== "microphone") ||
      (input.encoder !== "auto" && input.encoder !== "software") ||
      (input.deviceID !== undefined &&
        (typeof input.deviceID !== "string" || !input.deviceID || input.deviceID.length > 512)) ||
      (input.microphoneID !== undefined &&
        (typeof input.microphoneID !== "string" ||
          !input.microphoneID ||
          input.microphoneID.length > 512)) ||
      (input.source === "screen" && input.deviceID !== undefined) ||
      (input.source !== "screen" && !input.deviceID) ||
      (input.source === "microphone" && input.microphoneID !== undefined)
    )
      throw new Error("Invalid native recording request.");
    return {
      projectID: input.projectID,
      source: input.source,
      encoder: input.encoder,
      ...(typeof input.deviceID === "string" ? { deviceID: input.deviceID } : {}),
      ...(typeof input.microphoneID === "string" ? { microphoneID: input.microphoneID } : {}),
      ...(input.streamURL !== undefined
        ? { streamURL: streamDestination(input.streamURL).url }
        : {}),
    };
  };
  ipcMain.handle(bridgeChannels.nativeRecordingDevices, (event) => {
    check(event);
    return recorder.devices();
  });
  ipcMain.handle(bridgeChannels.nativeRecordingList, async (event) => {
    check(event);
    const items = await recorder.list();
    const current = owner;
    if (
      current?.started &&
      !current.stopping &&
      items.some(
        (item) =>
          item.id === current.id && item.status !== "recording" && item.status !== "stopping",
      )
    )
      current.dispose();
    return items;
  });
  ipcMain.handle(bridgeChannels.nativeRecordingRetry, (event, id: unknown) => {
    check(event);
    if (typeof id !== "string" || !/^[a-z0-9-]{1,100}$/i.test(id))
      throw new Error("Invalid recording ID.");
    return recorder.retry(id);
  });
  ipcMain.handle(bridgeChannels.nativeRecordingStop, async (event) => {
    const frame = check(event);
    if (!owner || owner.sender !== event.sender || owner.frame !== frame || !owner.started)
      throw new Error("No native recording owned by this document.");
    const current = owner;
    current.stopping = true;
    try {
      return await recorder.stop();
    } finally {
      current.dispose();
    }
  });
  ipcMain.handle(bridgeChannels.nativeRecordingStreamStatus, (event) => {
    const frame = check(event);
    if (!owner || owner.sender !== event.sender || owner.frame !== frame || !owner.started)
      throw new Error("No native recording owned by this document.");
    return recorder.streamStatus();
  });
  ipcMain.handle(bridgeChannels.nativeRecordingStart, async (event, input: unknown) => {
    const frame = check(event);
    const request = parse(input);
    if (owner) throw new Error("Another native recording is active or awaiting confirmation.");
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window || !window.isVisible()) throw new Error("A visible recording window is required.");
    const current = {
      sender: event.sender,
      frame,
      invalid: false,
      started: false,
      stopping: false,
      id: undefined as string | undefined,
      dispose: () => {},
    };
    owner = current;
    const revoke = () => {
      current.invalid = true;
      if (current.started && !current.stopping) {
        current.stopping = true;
        void recorder
          .stop()
          .catch(() => {})
          .finally(current.dispose);
      }
    };
    const navigated = (_event: unknown, _url: string, _inPlace: boolean, main: boolean) => {
      if (main) revoke();
    };
    event.sender.on("did-start-navigation", navigated);
    event.sender.once("destroyed", revoke);
    event.sender.once("render-process-gone", revoke);
    current.dispose = () => {
      if (owner === current) owner = undefined;
      event.sender.removeListener("did-start-navigation", navigated);
      event.sender.removeListener("destroyed", revoke);
      event.sender.removeListener("render-process-gone", revoke);
    };
    try {
      const devices = await recorder.devices();
      const selected = request.deviceID
        ? devices.find((device) => device.id === request.deviceID && device.kind === request.source)
        : undefined;
      const mic = request.microphoneID
        ? devices.find(
            (device) => device.id === request.microphoneID && device.kind === "microphone",
          )
        : undefined;
      if ((request.deviceID && !selected) || (request.microphoneID && !mic))
        throw new Error("Selected device is unavailable. Refresh devices and try again.");
      for (const kind of [
        request.source === "camera" ? "camera" : null,
        request.source === "microphone" || request.microphoneID ? "microphone" : null,
      ] as const) {
        if (!kind || !["win32", "darwin"].includes(process.platform)) continue;
        if (["denied", "restricted"].includes(systemPreferences.getMediaAccessStatus(kind)))
          throw new Error(`Allow ${kind} access in system privacy settings, then retry.`);
      }
      if (current.invalid || !valid(event, frame)) throw new Error("Recording request expired.");
      const description =
        request.source === "screen"
          ? "the entire desktop"
          : `the selected ${request.source} (${selected?.name})`;
      const choice = await dialog.showMessageBox(window, {
        type: "question",
        title: request.streamURL ? "Start streaming and recording" : "Start native recording",
        message: `Record ${description}${mic ? ` and microphone (${mic.name})` : ""}${request.streamURL ? ` and send live to ${streamDestination(request.streamURL).label}` : ""}?`,
        detail:
          "Recording is saved on this device until you remove it. System audio is not recorded." +
          (request.streamURL
            ? " The destination receives the capture live. Streaming stops with recording. RTMP is unencrypted; RTMPS verifies TLS certificates."
            : ""),
        buttons: [
          "Cancel",
          request.streamURL ? "Start streaming and recording" : "Start recording",
        ],
        defaultId: 0,
        cancelId: 0,
      });
      if (choice.response !== 1) throw new Error("Recording cancelled.");
      if (current.invalid || !valid(event, frame) || !window.isVisible())
        throw new Error("Recording request expired.");
      const result = await recorder.start(request);
      current.id = result.id;
      current.started = true;
      if (current.invalid || !valid(event, frame)) {
        await recorder.stop();
        throw new Error("Recording request expired.");
      }
      return result;
    } catch (error) {
      current.dispose();
      throw error;
    }
  });
  return async () => {
    if (owner) {
      owner.invalid = true;
      owner.dispose();
    }
    await recorder.close();
  };
}
