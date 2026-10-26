// Run `vp run --filter @sidecut/client build` before this Node 24 example.
import { openProjectClient, ServiceError } from "../packages/client/dist/node.mjs";
const client = await openProjectClient();
const status = await client.status();
if (!status || typeof status !== "object" || typeof status.revision !== "number")
  throw new Error("Invalid status revision.");
const options = {
  expectedRevision: status.revision,
  idempotencyKey: crypto.randomUUID(),
  label: "Bulk metadata example",
};
const commands = [
  {
    updateProject: {
      patch: { metadata: { example: "bulk edit", exampleTime: new Date().toISOString() } },
    },
  },
];
try {
  process.stdout.write(JSON.stringify(await client.apply(commands, options)) + "\n");
} catch (error) {
  if (error instanceof ServiceError && error.code === "staleRevision")
    process.stderr.write("Project changed. Read and rebuild the edit before trying again.\n");
  else
    process.stderr.write(
      "Request failed. Retain the same commands, expectedRevision and idempotencyKey if retrying an ambiguous completion.\n",
    );
  process.exitCode = 1;
}
