import { SideCutClient } from "./index";
import { verifyProjectOwner } from "../../../scripts/cli-foundation.mjs";
import { acquireProjectHost } from "../../../scripts/headless-host.mjs";
import { watchHost } from "../../../scripts/host-client.mjs";
export * from "./index";

/** Reuse the owner or host a closed project until close() / async disposal. */
export async function openProjectClient(
  project?: string,
  options: { endpointFile?: string; author?: string; signal?: AbortSignal } = {},
) {
  const flags = new Map<string, string>();
  if (project != null) flags.set("project", project);
  if (options.endpointFile != null) flags.set("endpoint-file", options.endpointFile);
  const found = await acquireProjectHost(flags, options.signal ? { signal: options.signal } : {});
  const client = new SideCutClient(
    found.endpoint,
    fetch,
    options.author ?? process.env.SIDECUT_AUTHOR ?? process.env.TANDEM_AUTHOR ?? "sdk",
  );
  try {
    await verifyProjectOwner(found.project, await client.status(options.signal));
  } catch (error) {
    await found.close();
    throw error;
  }
  return Object.assign(client, {
    close: found.close,
    [Symbol.asyncDispose]: found.close,
    events: (eventOptions?: { signal?: AbortSignal; lastEventID?: number }) =>
      watchHost(found.endpoint, eventOptions),
  });
}
