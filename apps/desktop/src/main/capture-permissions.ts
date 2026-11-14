import {
  BrowserWindow,
  desktopCapturer,
  dialog,
  ipcMain,
  session,
  systemPreferences,
  webContents,
} from "electron";
import type { IpcMainInvokeEvent } from "electron";
import { bridgeChannels } from "../shared/bridge";
import {
  grantApproved,
  grantDisplayGranted,
  grantExpired,
  grantTransition,
  type GrantEvent,
  type GrantState,
} from "./capture-grant-state.ts";

type Grant = {
  id: string;
  source: "screen" | "camera" | "microphone";
  microphone: boolean;
  /** The only lifecycle record: approval, display selection and revocation. */
  state: GrantState;
  frame: Electron.WebFrameMain;
  dispose: () => void;
};

/** Grants belong to one document and one explicit recording, never to an origin globally. */
export function registerCapturePermissions(isTrusted: (url: string) => boolean) {
  const grants = new Map<number, Grant>();
  const check = (event: IpcMainInvokeEvent) => {
    if (
      !event.senderFrame ||
      event.senderFrame !== event.sender.mainFrame ||
      !isTrusted(event.senderFrame.url)
    )
      throw new Error("Untrusted capture sender.");
    return event.senderFrame;
  };
  const current = (id: number) => {
    const grant = grants.get(id);
    if (grant && !grantExpired(grant.state, Date.now())) return grant;
    grant?.dispose();
    return undefined;
  };
  const advance = (grant: Grant, event: GrantEvent) => {
    grant.state = grantTransition(grant.state, event);
  };
  ipcMain.handle(bridgeChannels.capturePrepare, async (event, id: unknown, input: unknown) => {
    const frame = check(event);
    if (
      typeof id !== "string" ||
      !/^[a-f0-9-]{36}$/.test(id) ||
      !input ||
      typeof input !== "object" ||
      !("source" in input) ||
      !["screen", "camera", "microphone"].includes(String(input.source)) ||
      !("microphone" in input) ||
      typeof input.microphone !== "boolean"
    )
      throw new Error("Invalid capture request.");
    const source = input.source;
    if (source !== "screen" && source !== "camera" && source !== "microphone")
      throw new Error("Invalid capture source.");
    if (current(event.sender.id)) throw new Error("Another capture request is active.");
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) throw new Error("Recording window is closed.");
    const grant: Grant = {
      id,
      source,
      microphone: input.microphone || source === "microphone",
      state: { kind: "awaitingApproval", expires: Date.now() + 60_000 },
      frame,
      dispose: () => {},
    };
    grants.set(event.sender.id, grant);
    const revoke = () => grant.dispose();
    const navigated = (_event: unknown, _url: string, _inPlace: boolean, main: boolean) => {
      if (main) revoke();
    };
    event.sender.on("did-start-navigation", navigated);
    event.sender.once("destroyed", revoke);
    event.sender.once("render-process-gone", revoke);
    const cleanup = () => {
      event.sender.removeListener("did-start-navigation", navigated);
      event.sender.removeListener("destroyed", revoke);
      event.sender.removeListener("render-process-gone", revoke);
    };
    // A bounded grant cannot survive a stalled renderer, even if its release IPC never arrives.
    let timer = setTimeout(revoke, 60_000);
    timer.unref();
    grant.dispose = () => {
      advance(grant, { type: "revoke" });
      if (grants.get(event.sender.id) === grant) grants.delete(event.sender.id);
      clearTimeout(timer);
      cleanup();
    };
    try {
      for (const kind of [
        source === "camera" ? "camera" : null,
        grant.microphone ? "microphone" : null,
      ] as const) {
        if (!kind || !["win32", "darwin"].includes(process.platform)) continue;
        const status = systemPreferences.getMediaAccessStatus(kind);
        if (status === "denied" || status === "restricted")
          throw new Error(`Allow ${kind} access in system privacy settings, then retry.`);
      }
      if (source !== "screen") {
        const choice = await dialog.showMessageBox(window, {
          type: "question",
          title: "Allow recording",
          message:
            source === "camera"
              ? `Record the selected camera${grant.microphone ? " and microphone" : ""}?`
              : "Record the selected microphone?",
          detail: "Access ends when this recording stops. Files stay on this device.",
          buttons: ["Cancel", "Allow recording"],
          defaultId: 0,
          cancelId: 0,
        });
        if (choice.response !== 1) throw new Error("Recording permission cancelled.");
      }
      if (
        current(event.sender.id) !== grant ||
        event.sender.isDestroyed() ||
        event.senderFrame !== event.sender.mainFrame
      )
        throw new Error("Capture request expired or was cancelled.");
      advance(grant, { type: "approve", expires: Date.now() + 310_000 });
      clearTimeout(timer);
      timer = setTimeout(revoke, 310_000);
      timer.unref();
    } catch (error) {
      revoke();
      cleanup();
      clearTimeout(timer);
      throw error;
    }
  });
  ipcMain.handle(bridgeChannels.captureRelease, (event, id: unknown) => {
    check(event);
    const grant = current(event.sender.id);
    if (grant && grant.id === id) grant.dispose();
  });
  const allowed = (
    contents: Electron.WebContents | null,
    permission: string,
    url: string,
    types: string[],
  ) => {
    if (!contents || !isTrusted(url) || !isTrusted(contents.getURL())) return false;
    const grant = current(contents.id);
    if (
      !grant ||
      !grantApproved(grant.state) ||
      grant.frame !== contents.mainFrame ||
      !isTrusted(grant.frame.url)
    )
      return false;
    if (permission === "display-capture") return grant.source === "screen";
    return (
      permission === "media" &&
      types.length > 0 &&
      types.every(
        (type) =>
          (type === "video" && grant.source === "camera") ||
          (type === "audio" &&
            grant.microphone &&
            (grant.source !== "screen" || grantDisplayGranted(grant.state))),
      )
    );
  };
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    callback(
      details.isMainFrame &&
        allowed(
          contents,
          permission,
          details.requestingUrl,
          "mediaTypes" in details ? (details.mediaTypes ?? []) : [],
        ),
    );
  });
  session.defaultSession.setPermissionCheckHandler(
    (contents, permission, origin, details) =>
      details.isMainFrame &&
      allowed(contents, permission, origin, details.mediaType ? [details.mediaType] : []),
  );
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    const contents = request.frame && webContents.fromFrame(request.frame);
    const grant = contents && current(contents.id);
    if (
      !contents ||
      request.frame !== contents.mainFrame ||
      !allowed(contents, "display-capture", request.securityOrigin, []) ||
      !grant ||
      grant.state.kind !== "approved" ||
      !request.videoRequested ||
      request.audioRequested
    ) {
      callback({});
      return;
    }
    advance(grant, { type: "beginDisplay" });
    const reject = () => {
      advance(grant, { type: "displayRejected" });
      callback({});
    };
    void (async () => {
      try {
        const sources = await desktopCapturer.getSources({
          types: ["screen", "window"],
          thumbnailSize: { width: 0, height: 0 },
        });
        const window = BrowserWindow.fromWebContents(contents);
        if (!window || current(contents.id) !== grant || request.frame !== contents.mainFrame) {
          reject();
          return;
        }
        const choice = await dialog.showMessageBox(window, {
          title: "Choose a recording source",
          message: "Choose a screen or window to record",
          detail: grant.microphone
            ? "The selected microphone will also be recorded. System audio is excluded."
            : "System audio is excluded.",
          buttons: ["Cancel", ...sources.map((source) => source.name)],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
        });
        const selected = sources[choice.response - 1];
        if (
          !selected ||
          current(contents.id) !== grant ||
          contents.isDestroyed() ||
          request.frame !== contents.mainFrame
        ) {
          reject();
          return;
        }
        const available = await desktopCapturer.getSources({
          types: ["screen", "window"],
          thumbnailSize: { width: 0, height: 0 },
        });
        const live = available.find((source) => source.id === selected.id);
        if (
          current(contents.id) !== grant ||
          contents.isDestroyed() ||
          request.frame !== contents.mainFrame ||
          !live
        ) {
          reject();
          return;
        }
        advance(grant, { type: "displayChosen" });
        callback({ video: live });
      } catch {
        reject();
      }
    })();
  });
}
