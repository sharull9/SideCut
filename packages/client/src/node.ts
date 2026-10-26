import { SideCutClient } from "./index";
import { discoverEndpoint, verifyProjectOwner } from "../../../scripts/cli-foundation.mjs";
export * from "./index";

/** Connect to an existing owner using the same discovery rules as the CLI. */
export async function openProjectClient(
  project?: string,
  options: { endpointFile?: string; author?: string; signal?: AbortSignal } = {},
) {
  const flags = new Map<string, string>();
  if (project != null) flags.set("project", project);
  if (options.endpointFile != null) flags.set("endpoint-file", options.endpointFile);
  const found = await discoverEndpoint(flags);
  const client = new SideCutClient(
    found.endpoint,
    fetch,
    options.author ?? process.env.SIDECUT_AUTHOR ?? process.env.TANDEM_AUTHOR ?? "sdk",
  );
  await verifyProjectOwner(found.project, await client.status(options.signal));
  return client;
}
