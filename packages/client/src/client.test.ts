import { it, expect } from "vite-plus/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostProjectService } from "../../../apps/desktop/src/main/project-service.ts";
import { NativeProjectStore } from "../../../apps/desktop/src/main/project-store.ts";
import { ProjectAPI } from "../../../apps/desktop/src/main/project-api.ts";
import { LocalHTTPService } from "../../../apps/desktop/src/main/http-service.ts";
import { SideCutClient, ServiceError } from "./index";
it("retries an ambiguously completed bulk edit once and preserves conflict details", async () => {
  const root = await mkdtemp(join(tmpdir(), "sidecut-client-"));
  const host = new HostProjectService(new NativeProjectStore(join(root, "current.tandem")));
  await host.start();
  const server = new LocalHTTPService(new ProjectAPI(host)),
    endpoint = await server.start();
  try {
    let loseReply = true;
    const client = new SideCutClient(endpoint, async (...args) => {
      const response = await fetch(...args);
      if (loseReply) {
        loseReply = false;
        await response.text();
        throw new Error("Lost response");
      }
      return response;
    });
    const commands = [{ updateProject: { patch: { name: "Client batch" } } }];
    const options = { expectedRevision: 0, idempotencyKey: "client-edit" };
    await expect(client.apply(commands, options)).rejects.toThrow("Lost response");
    expect(await client.apply(commands, options)).toMatchObject({ revision: 1, repeated: true });
    await expect(
      client.apply(commands, { expectedRevision: 0, idempotencyKey: "other-edit" }),
    ).rejects.toMatchObject({ code: "staleRevision", revision: 1 });
    expect(await client.call("status", {})).toMatchObject({ name: "Client batch", revision: 1 });
    expect(ServiceError.prototype).toBeInstanceOf(Error);
  } finally {
    await server.close();
    await host.close();
    await rm(root, { recursive: true, force: true });
  }
});
