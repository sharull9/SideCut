import { ipcMain } from "electron";
import type { IpcMainInvokeEvent } from "electron";
import { validateDelivery } from "./delivery-service.ts";
import type { NativeDeliveryService } from "./delivery-service.ts";

export function registerNativeDelivery(
  service: NativeDeliveryService,
  isTrusted: (url: string) => boolean,
  headless: boolean,
) {
  let closing = false;
  const completions = new Set<Promise<unknown>>();
  const jobs = new Map<
    Electron.WebContents,
    { id: string; frame: Electron.WebFrameMain; controller: AbortController }
  >();
  const check = (event: IpcMainInvokeEvent) => {
    const frame = event.senderFrame;
    if (
      closing ||
      headless ||
      event.sender.isDestroyed() ||
      !frame ||
      frame !== event.sender.mainFrame ||
      !isTrusted(frame.url)
    )
      throw new Error("Untrusted delivery sender.");
    return frame;
  };
  const requestID = (id: unknown): string => {
    if (
      typeof id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
    )
      throw new Error("Invalid delivery request ID.");
    return id;
  };
  ipcMain.handle(
    "sidecut:delivery-encode",
    async (event, id: unknown, inputID: unknown, value: unknown) => {
      const frame = check(event),
        idValue = requestID(id),
        request = validateDelivery(inputID, value);
      if (typeof inputID !== "string") throw new Error("Invalid delivery input.");
      if (jobs.has(event.sender) || jobs.size >= 2) throw new Error("Delivery capacity is busy.");
      const job = { id: idValue, frame, controller: new AbortController() };
      jobs.set(event.sender, job);
      const revoke = () => job.controller.abort();
      const navigation = (_event: unknown, _url: string, _inPlace: boolean, main: boolean) => {
        if (main) revoke();
      };
      event.sender.on("did-start-navigation", navigation);
      event.sender.once("destroyed", revoke);
      event.sender.once("render-process-gone", revoke);
      try {
        const completion = service.encode(inputID, request, job.controller.signal);
        completions.add(completion);
        let result;
        try {
          result = await completion;
        } finally {
          completions.delete(completion);
        }
        if (job.controller.signal.aborted || check(event) !== frame)
          throw new Error("Delivery request expired.");
        return result;
      } finally {
        jobs.delete(event.sender);
        event.sender.removeListener("did-start-navigation", navigation);
        event.sender.removeListener("destroyed", revoke);
        event.sender.removeListener("render-process-gone", revoke);
      }
    },
  );
  ipcMain.handle("sidecut:delivery-cancel", (event, id: unknown) => {
    const frame = check(event),
      job = jobs.get(event.sender);
    if (!job || job.frame !== frame || job.id !== requestID(id))
      throw new Error("No matching delivery job.");
    job.controller.abort();
  });
  return async () => {
    closing = true;
    for (const job of jobs.values()) job.controller.abort();
    await Promise.allSettled([...completions]);
  };
}
