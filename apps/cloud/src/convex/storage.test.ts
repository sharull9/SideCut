import { describe, expect, it, vi, afterEach } from "vite-plus/test";
import { defineTestApp } from "convex-test";
import { S3Client } from "@aws-sdk/client-s3";
import schema from "./schema";
import * as teams from "./teams";
import * as library from "./library";
import * as versions from "./versions";
import * as storage from "./storage";

const { api, createTest } = defineTestApp({ schema }).defineModules({
  teams,
  library,
  versions,
  storage,
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("private R2 action boundary", () => {
  it("fails closed before contacting storage for missing membership or configuration", async () => {
    const t = createTest();
    const a = t.withIdentity({ subject: "alice", issuer: "https://api.workos.com/" });
    const b = t.withIdentity({ subject: "bob", issuer: "https://api.workos.com/" });
    const teamId = await a.mutation(api.teams.create, { name: "A" });
    const mediaId = await a.mutation(api.library.create, { teamId, name: "Render" });
    const versionId = await a.mutation(api.versions.begin, {
      mediaId,
      requestId: "one",
      snapshot: "{}",
      expectedBytes: 10,
      partCount: 1,
    });
    vi.stubEnv("R2_ACCOUNT_ID", "");
    const send = vi.spyOn(S3Client.prototype, "send");
    await expect(b.action(api.storage.start, { versionId })).rejects.toThrow("access denied");
    await expect(a.action(api.storage.start, { versionId })).rejects.toThrow("not configured");
    await expect(b.action(api.storage.partUrl, { versionId, part: 1 })).rejects.toThrow(
      "access denied",
    );
    await expect(b.action(api.storage.complete, { versionId })).rejects.toThrow("access denied");
    await expect(b.action(api.storage.playbackUrl, { mediaId })).rejects.toThrow("access denied");
    expect(send).not.toHaveBeenCalled();
  });
});
