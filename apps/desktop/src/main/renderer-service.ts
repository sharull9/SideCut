import { BrowserWindow, ipcMain } from "electron";
import type { IpcMainInvokeEvent } from "electron";
import { randomUUID } from "node:crypto";
import type { HostProjectService } from "./project-service.ts";
import { bridgeChannels } from "../shared/bridge.ts";
import { EditError } from "@sidecut/core/coordinator";
import { QueryError } from "@sidecut/core/project-queries";
import { rendererMutations } from "@sidecut/core/service-requests";
import { projectDuration } from "@sidecut/core/render-plan";
import { decodeProjectFile } from "@sidecut/contracts/project";
export function rendererService(
  project: HostProjectService,
  isTrusted: (url: string) => boolean,
  onJobs: (jobs: unknown[]) => void = () => {},
) {
  const ready = new Set<number>(),
    pending = new Map<
      string,
      {
        sender: number;
        operation: string;
        finish: (result: unknown, error?: string) => void;
        progress?: (value: number) => void;
      }
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
  ipcMain.handle(bridgeChannels.serviceProgress, (event, id: unknown, progress: unknown) => {
    check(event);
    if (
      typeof id !== "string" ||
      typeof progress !== "number" ||
      !Number.isFinite(progress) ||
      progress < 0 ||
      progress > 1
    )
      throw new Error("Invalid service progress.");
    const request = pending.get(id);
    if (request?.sender === event.sender.id) request.progress?.(progress);
  });
  ipcMain.handle(bridgeChannels.serviceJobs, (event, jobs: unknown) => {
    check(event);
    if (!Array.isArray(jobs) || jobs.length > 500 || JSON.stringify(jobs).length > 512 * 1024)
      throw new Error("Invalid job update.");
    onJobs(jobs);
  });
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
    progress?: (value: number) => void,
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
            detail.code === "staleRevision"
              ? new EditError(
                  "stale-revision",
                  typeof detail.message === "string" ? detail.message : "Stale project revision.",
                )
              : new QueryError(
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
      const exportSeconds = ["clip", "export"].includes(operation)
        ? Math.max(
            0,
            Number(
              input.end ?? input.to ?? projectDuration(decodeProjectFile(file).project).seconds,
            ) - Number(input.start ?? input.from ?? 0),
          )
        : 0;
      const timer = setTimeout(
        cancel,
        Math.min(
          ["transcribe", "wait", "clip", "export"].includes(operation) ? 86401000 : 610000,
          Math.max(
            1000,
            Math.max(Number(input.timeout ?? 600), exportSeconds * 20) * 1000 +
              (["wait", "transcribe"].includes(operation) ? 1000 : 0),
          ),
        ),
      );
      pending.set(id, {
        sender: target.webContents.id,
        operation,
        finish,
        ...(progress ? { progress } : {}),
      });
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
    ipcMain.removeHandler(bridgeChannels.serviceProgress);
    ipcMain.removeHandler(bridgeChannels.serviceJobs);
  };
  return {
    activate() {
      const target = window();
      if (!target) throw new QueryError("unavailable", "No ready editor window is attached.");
      if (target.isMinimized()) target.restore();
      target.show();
      target.focus();
    },
    run,
    screenshot,
    close,
    ready: () => Boolean(window()),
  };
}
