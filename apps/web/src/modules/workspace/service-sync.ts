import type { BrowserProjectSession } from "./browser-session";
import { soundTargets, soundSyncPlan } from "@sidecut/core/service-sync";
import { QueryError } from "@sidecut/core/project-queries";
import { readMono } from "@sidecut/platform-browser/source-analysis";
import { syncSound } from "@sidecut/platform-browser/sound-sync";

export async function syncService(
  session: BrowserProjectSession,
  request: Record<string, unknown>,
  signal: AbortSignal,
) {
  const file = session.projectFile(),
    { items, reference } = soundTargets(file, request);
  const load = async (item: typeof reference) => {
    if ((item.duration?.seconds ?? Infinity) > 60)
      throw new QueryError("badRequest", "Browser sound sync supports sources up to 60 seconds.");
    const resource = await session.resource(item.id);
    if (resource?.state !== "available")
      throw new QueryError("notFound", `Missing sound source: ${item.path}.`);
    return readMono(resource.file, item, 8000, signal, () => {});
  };
  const camera = await load(reference),
    measured = [];
  for (const item of items) {
    signal.throwIfAborted();
    measured.push({ item, match: await syncSound(camera.slice(), await load(item), signal) });
  }
  signal.throwIfAborted();
  return {
    revision: file.revision,
    ...soundSyncPlan(file, reference, measured, request.place !== false),
    warnings: ["Sound alignment is limited to 60-second sources; clock drift is not measured."],
  };
}
