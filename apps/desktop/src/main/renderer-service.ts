import { BrowserWindow, ipcMain } from "electron";
import type { IpcMainInvokeEvent } from "electron";
import { randomUUID } from "node:crypto";
import type { HostProjectService } from "./project-service.ts";
import { bridgeChannels } from "../shared/bridge.ts";
import { QueryError } from "@sidecut/core/project-queries";
import { rendererMutations } from "@sidecut/core/service-requests";
export function rendererService(project: HostProjectService, isTrusted: (url: string) => boolean) {
  const ready = new Set<number>(),
    pending = new Map<
      string,
      { sender: number; operation: string; finish: (result: unknown, error?: string) => void }
    >();
  const check = (event: IpcMainInvokeEvent) => {
    if (event.senderFrame !== event.sender.mainFrame || !isTrusted(event.senderFrame?.url ?? ""))
      throw new Error("Untrusted service sender.");
  };
  const window = () =>
    BrowserWindow.getAllWindows().find(
      (w) =>
        ready.has(w.webContents.id) &&
        !w.webContents.isDestroyed() &&
        isTrusted(w.webContents.getURL()),
    );
  ipcMain.handle(bridgeChannels.serviceReady, (event, value: unknown) => {
    check(event);
    if (typeof value !== "boolean") throw new Error("Invalid renderer readiness.");
    if (value) ready.add(event.sender.id);
    else ready.delete(event.sender.id);
  });
  ipcMain.handle(
    bridgeChannels.serviceReply,
    (event, id: unknown, result: unknown, error: unknown) => {
      check(event);
      if (typeof id !== "string" || (error !== undefined && typeof error !== "string"))
        throw new Error("Invalid service response.");
      const request = pending.get(id);
      if (!request || request.sender !== event.sender.id) return;
      if (JSON.stringify(result ?? null).length > 360 * 1024 * 1024)
        throw new Error("Service response exceeds limits.");
      request.finish(result, error as string | undefined);
    },
  );
  const run = (
    operation: string,
    input: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<unknown> => {
    const target = window();
    if (!target)
      return Promise.reject(new QueryError("unavailable", "No ready editor renderer is attached."));
    if (
      pending.size >= 8 ||
      ([...pending.values()].some((p) => !["wait", "query-state"].includes(p.operation)) &&
        !["query-state", "timeline", "wait", "comments"].includes(operation))
    )
      return Promise.reject(
        new QueryError("unavailable", "Another renderer service operation is running."),
      );
    signal.throwIfAborted();
    const snapshot = project.snapshot(),
      file = JSON.parse(snapshot.json),
      id = randomUUID();
    return new Promise((resolve, reject) => {
      const finish = (result: unknown, error?: string) => {
        if (!pending.delete(id)) return;
        clearTimeout(timer);
        signal.removeEventListener("abort", cancel);
        target.webContents.removeListener("destroyed", closed);
        const current = project.snapshot();
        if (error) {
          let detail: { code?: unknown; message?: unknown } = {};
          try {
            const parsed: unknown = JSON.parse(error);
            if (parsed && typeof parsed === "object") detail = parsed;
          } catch {
            /* Older renderers return plain text. */
          }
          reject(
            new QueryError(
              detail.code === "badRequest" ||
                detail.code === "notFound" ||
                detail.code === "notImplemented"
                ? detail.code
                : "unavailable",
              typeof detail.message === "string" ? detail.message : error,
            ),
          );
        } else if (
          current.generation !== snapshot.generation ||
          (!rendererMutations.has(operation) &&
            operation !== "wait" &&
            operation !== "transcribe" &&
            JSON.parse(current.json).revision !== file.revision)
        )
          reject(
            new QueryError(
              "unavailable",
              "Project changed while the renderer operation was running.",
            ),
          );
        else resolve(result);
      };
      const cancel = () => {
        if (!target.webContents.isDestroyed())
          target.webContents.send(bridgeChannels.serviceRequest, { id, type: "cancel" });
        finish(null, "Renderer operation cancelled.");
      };
      const closed = () => finish(null, "Editor window closed.");
      const timer = setTimeout(
        cancel,
        Math.min(
          ["transcribe", "wait"].includes(operation) ? 86401000 : 610000,
          Math.max(
            1000,
            Number(input.timeout ?? 600) * 1000 +
              (["wait", "transcribe"].includes(operation) ? 1000 : 0),
          ),
        ),
      );
      pending.set(id, { sender: target.webContents.id, operation, finish });
      target.webContents.once("destroyed", closed);
      signal.addEventListener("abort", cancel, { once: true });
      target.webContents.send(bridgeChannels.serviceRequest, {
        id,
        type: "call",
        operation,
        input,
        projectID: file.project.id,
        generation: snapshot.generation,
        revision: file.revision,
      });
    });
  };
  const screenshot = async () => {
    const target = window();
    if (!target) throw new QueryError("unavailable", "No editor window is available for capture.");
    return new Uint8Array((await target.webContents.capturePage()).toPNG());
  };
  const close = () => {
    for (const request of pending.values()) request.finish(null, "Desktop service is closing.");
    ipcMain.removeHandler(bridgeChannels.serviceReady);
    ipcMain.removeHandler(bridgeChannels.serviceReply);
  };
  return { run, screenshot, close, ready: () => Boolean(window()) };
}
