import { BrowserWindow, dialog, ipcMain, systemPreferences } from "electron";
import type { IpcMainInvokeEvent } from "electron";
import type { NativeRecordingRequest } from "@sidecut/contracts/native-recording";
import { streamDestination, streamDestinations } from "./native-streaming.ts";
import { bridgeChannels } from "../shared/bridge.ts";
import type { NativeRecorder } from "./native-recorder.ts";
import {
  OwnerCommandError,
  ownerInvalid,
  ownerStarted,
  ownerTransition,
  type OwnerEvent,
  type OwnerState,
} from "./native-recorder-owner-state.ts";

export function registerNativeRecorder(
  recorder: NativeRecorder,
  isTrusted: (url: string) => boolean,
  headless: boolean,
) {
  let owner:
    | {
        sender: Electron.WebContents;
        frame: Electron.WebFrameMain;
        /** The only lifecycle record: confirming, starting, active, stopping or invalidating. */
        state: OwnerState;
        dispose: () => void;
      }
    | undefined;
  type Owner = NonNullable<typeof owner>;
  /** Transition first; the returned effects run after the owner already changed state. */
  const advance = (target: Owner, event: OwnerEvent) => {
    const step = ownerTransition(target.state, event);
    if (step.state) target.state = step.state;
    return step;
  };
  const owns = (event: IpcMainInvokeEvent, frame: Electron.WebFrameMain) =>
    owner !== undefined &&
    owner.sender === event.sender &&
    owner.frame === frame &&
    ownerStarted(owner.state);
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
          ![
            "projectID",
            "source",
            "deviceID",
            "microphoneID",
            "encoder",
            "streamURL",
            "streamURLs",
          ].includes(key),
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
    const destinations = streamDestinations(input.streamURL, input.streamURLs);
    return {
      projectID: input.projectID,
      source: input.source,
      encoder: input.encoder,
      ...(typeof input.deviceID === "string" ? { deviceID: input.deviceID } : {}),
      ...(typeof input.microphoneID === "string" ? { microphoneID: input.microphoneID } : {}),
      ...(input.streamURLs !== undefined ? { streamURLs: destinations } : {}),
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
    const state = current?.state;
    if (
      state?.kind === "active" &&
      items.some(
        (item) => item.id === state.id && item.status !== "recording" && item.status !== "stopping",
      )
    )
      current?.dispose();
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
    if (!owns(event, frame) || !owner)
      throw new Error("No native recording owned by this document.");
    const current = owner;
    try {
      advance(current, { type: "stop" });
    } catch (error) {
      if (error instanceof OwnerCommandError) throw new Error(error.message, { cause: error });
      throw error;
    }
    try {
      return await recorder.stop();
    } finally {
      current.dispose();
    }
  });
  ipcMain.handle(bridgeChannels.nativeRecordingStreamStatus, (event) => {
    const frame = check(event);
    if (!owns(event, frame)) throw new Error("No native recording owned by this document.");
    return recorder.streamStatus();
  });
  ipcMain.handle(bridgeChannels.nativeRecordingStart, async (event, input: unknown) => {
    const frame = check(event);
    const request = parse(input);
    if (owner) throw new Error("Another native recording is active or awaiting confirmation.");
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window || !window.isVisible()) throw new Error("A visible recording window is required.");
    const current: Owner = {
      sender: event.sender,
      frame,
      state: { kind: "confirming" },
      dispose: () => {},
    };
    owner = current;
    const revoke = () => {
      if (advance(current, { type: "invalidate" }).stopRecorder) {
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
      if (ownerInvalid(current.state) || !valid(event, frame))
        throw new Error("Recording request expired.");
      const description =
        request.source === "screen"
          ? "the entire desktop"
          : `the selected ${request.source} (${selected?.name})`;
      const destinations = streamDestinations(request.streamURL, request.streamURLs);
      const streaming = destinations.length > 0;
      const choice = await dialog.showMessageBox(window, {
        type: "question",
        title: streaming ? "Start streaming and recording" : "Start native recording",
        message: `Record ${description}${mic ? ` and microphone (${mic.name})` : ""}${streaming ? ` and send live to ${destinations.map((url) => streamDestination(url).label).join(", ")}` : ""}?`,
        detail:
          "Recording is saved on this device until you remove it. System audio is not recorded." +
          (streaming
            ? " The destination receives the capture live. Streaming stops with recording. RTMP is unencrypted; RTMPS verifies TLS certificates."
            : ""),
        buttons: ["Cancel", streaming ? "Start streaming and recording" : "Start recording"],
        defaultId: 0,
        cancelId: 0,
      });
      if (choice.response !== 1) throw new Error("Recording cancelled.");
      if (ownerInvalid(current.state) || !valid(event, frame) || !window.isVisible())
        throw new Error("Recording request expired.");
      advance(current, { type: "confirmed" });
      const result = await recorder.start(request);
      const started = advance(current, { type: "started", id: result.id });
      if (started.stopLateStart || ownerInvalid(current.state) || !valid(event, frame)) {
        if (!started.stopLateStart) advance(current, { type: "invalidate" });
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
      advance(owner, { type: "invalidate" });
      owner.dispose();
    }
    await recorder.close();
  };
}
