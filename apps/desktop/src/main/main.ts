import { BrowserWindow, app, dialog, ipcMain, net, protocol, session, shell } from "electron";
import { stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  bridgeChannels,
  rendererHost,
  rendererOrigin,
  rendererScheme,
  type DesktopAppInfo,
} from "../shared/bridge.ts";
import { resolveRendererPath } from "./renderer-path.ts";
import { DesktopAssetProviders } from "./asset-providers.ts";
import { HostProjectService } from "./project-service.ts";
import { NativeProjectStore } from "./project-store.ts";
import { registerNativeIPC } from "./native-ipc.ts";

const here = dirname(fileURLToPath(import.meta.url));
const smoke = app.commandLine.hasSwitch("smoke-test");
let exitCode = 0;
if (smoke) {
  const profile = app.commandLine.getSwitchValue("smoke-profile");
  if (!profile || !app.commandLine.getSwitchValue("smoke-output"))
    throw new Error("Smoke verification requires a profile and output path.");
  app.setPath("userData", profile);
}

// SIDECUT_RENDERER_URL points the window at a local web dev server instead of the build.
const devUrl = (() => {
  const value = process.env["SIDECUT_RENDERER_URL"];
  if (!value) return undefined;
  const url = new URL(value);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname))
    throw new Error("SIDECUT_RENDERER_URL must be a local http URL.");
  return url;
})();
const trustedUrl = devUrl ?? new URL(rendererOrigin);

const rendererRoot = app.isPackaged
  ? join(process.resourcesPath, "renderer")
  : join(app.getAppPath(), "..", "web", ".output", "public");

protocol.registerSchemesAsPrivileged([
  {
    scheme: rendererScheme,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

// URL.origin is "null" for custom schemes, so compare protocol and host directly.
const isTrusted = (url: string) => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === trustedUrl.protocol && parsed.host === trustedUrl.host;
  } catch {
    return false;
  }
};

const serveRenderer = () =>
  protocol.handle(rendererScheme, async (request) => {
    const url = new URL(request.url);
    const file = url.host === rendererHost && resolveRendererPath(rendererRoot, url.pathname);
    const found = file && (await stat(file).catch(() => undefined))?.isFile();
    if (!file || !found) return new Response("Not found", { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });

const createWindow = () => {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    title: "SideCut",
    show: false,
    webPreferences: {
      preload: join(here, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });
  window.once("ready-to-show", () => {
    if (!smoke) window.show();
  });

  const { webContents } = window;
  webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  webContents.on("will-navigate", (event, url) => {
    if (!isTrusted(url)) event.preventDefault();
  });

  void window.loadURL(devUrl?.href ?? `${rendererOrigin}/`);
  return window;
};

app.on("web-contents-created", (_event, contents) => {
  contents.on("will-attach-webview", (event) => event.preventDefault());
});

void app.whenReady().then(() => {
  const providers = new DesktopAssetProviders(join(app.getPath("userData"), "assets")),
    requests = new Map<string, AbortController>();
  ipcMain.handle(bridgeChannels.providerCall, async (event, id: unknown, request: unknown) => {
    if (
      !event.senderFrame ||
      !isTrusted(event.senderFrame.url) ||
      typeof id !== "string" ||
      !/^[a-z0-9-]{1,100}$/i.test(id)
    )
      throw new Error("Invalid provider sender or request ID.");
    const prefix = `${event.sender.id}:`,
      key = `${prefix}${id}`;
    if (requests.has(key) || [...requests.keys()].filter((k) => k.startsWith(prefix)).length >= 4)
      throw new Error("Provider request is duplicate or the concurrency limit was reached.");
    const controller = new AbortController();
    requests.set(key, controller);
    const stop = () => controller.abort();
    event.sender.once("destroyed", stop);
    try {
      return await providers.call(request, controller.signal);
    } finally {
      requests.delete(key);
      event.sender.removeListener("destroyed", stop);
    }
  });
  ipcMain.handle(bridgeChannels.providerCancel, (event, id: unknown) => {
    if (!event.senderFrame || !isTrusted(event.senderFrame.url) || typeof id !== "string")
      throw new Error("Untrusted provider sender.");
    requests.get(`${event.sender.id}:${id}`)?.abort();
  });
  ipcMain.handle(
    bridgeChannels.providerCredential,
    async (event, provider: unknown, action: unknown, secret: unknown) => {
      if (!event.senderFrame || !isTrusted(event.senderFrame.url) || typeof provider !== "string")
        throw new Error("Untrusted credential sender.");
      if (action === "set") await providers.credentials.set(provider, secret);
      else if (action === "clear") await providers.credentials.clear(provider);
      else throw new Error("Invalid credential action.");
    },
  );
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false),
  );
  session.defaultSession.setPermissionCheckHandler(() => false);

  ipcMain.handle(bridgeChannels.appInfo, (event): DesktopAppInfo => {
    if (!event.senderFrame || !isTrusted(event.senderFrame.url))
      throw new Error("Untrusted sender.");
    return {
      name: app.getName(),
      version: app.getVersion(),
      platform: process.platform,
      versions: { electron: process.versions.electron, chrome: process.versions.chrome },
    };
  });

  serveRenderer();
  const project = new HostProjectService(
    new NativeProjectStore(join(app.getPath("userData"), "current.tandem")),
  );
  void project
    .start()
    .then(() => {
      const close = registerNativeIPC(project, isTrusted);
      let quitting = false;
      app.on("before-quit", (event) => {
        if (quitting) return;
        event.preventDefault();
        quitting = true;
        void close().then(
          () => {
            if (smoke) app.exit(exitCode);
            else app.quit();
          },
          (error) => {
            console.error("Could not close the native project service:", error);
            app.exit(1);
          },
        );
      });
      const window = createWindow();
      if (smoke)
        void import("./packaged-smoke.ts")
          .then(({ verifyPackaged }) => verifyPackaged(window))
          .then((result) =>
            writeFile(
              app.commandLine.getSwitchValue("smoke-output"),
              JSON.stringify(result, null, 2) + "\n",
            ),
          )
          .catch((error) => {
            exitCode = 1;
            console.error("Packaged verification failed:", error);
          })
          .finally(() => app.quit());
    })
    .catch((error) => {
      console.error("Could not start the host project service:", error);
      if (smoke) {
        app.exit(1);
        return;
      }
      dialog.showErrorBox(
        "Could not open SideCut",
        error instanceof Error ? error.message : String(error),
      );
      app.quit();
    });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
