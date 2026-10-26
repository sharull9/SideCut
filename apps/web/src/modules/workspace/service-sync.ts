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
    warnings: measured.some(({ match }) => match.drift != null && Math.abs(match.drift) > 0.01)
      ? [
          "Recorder clock drift was measured. Alignment uses the offset at the overlap midpoint; clip speeds are unchanged.",
        ]
      : [],
  };
}
