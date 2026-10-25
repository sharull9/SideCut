import { afterEach, expect, it } from "vite-plus/test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { parseArguments } from "../../../../scripts/cli-foundation.mjs";
import { prepareQueryCommand, queryText, clock } from "../../../../scripts/cli-query-commands.mjs";
import contract from "../../../../tests/fixtures/tandem/cli-queries.json";
const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.reverse().splice(0)) await cleanup();
});
it("matches pinned text, clocks, scopes, partial/unused hits and missing words", () => {
  expect(queryText("transcript", contract.transcript.result)).toBe(contract.transcript.text);
  expect(queryText("search", contract.search.result)).toBe(contract.search.text);
  expect(clock(3661.001)).toBe("1:01:01.001");
  expect(clock(-1)).toBe("-00:01.000");
  expect(queryText("timeline", { text: "Timeline\n" })).toBe("Timeline");
  expect(queryText("media", { items: [], added: [] })).toContain("media --refresh");
  expect(
    queryText("media", {
      items: [
        {
          id: "m",
          path: "missing.wav",
          role: "camera",
          clips: 1,
          exists: false,
          analysis: {
            transcript: { state: "failed", message: "failed fixture" },
            proxy: { state: "running", progress: 0.45 },
          },
        },
      ],
      added: [],
    }),
  ).toContain("MISSING FILE  (transcript failed: failed fixture, proxy 45%)");
});
it("prepares native positionals, text/JSON defaults and revision-only output", () => {
  const status = prepareQueryCommand(parseArguments(["status", "--revision"]));
  expect(status?.text?.({ revision: contract.status.revision })).toBe(
    contract.status.revisionOutput,
  );
  expect(prepareQueryCommand(parseArguments(["timeline"]))?.prepare({})).toEqual({
    format: "text",
  });
  expect(
    prepareQueryCommand(parseArguments(["project", "timeline", "--json"]))?.prepare({}),
  ).toEqual({ format: "json" });
  expect(
    prepareQueryCommand(parseArguments(["search", "hello", "world"]))?.flags.get("phrase"),
  ).toBe("hello world");
  expect(
    prepareQueryCommand(parseArguments(["transcript", "m", "--make", "--timeout", "0"]))?.make,
  ).toBe(true);
  for (const args of [
    ["search"],
    ["transcript", "--make"],
    ["transcript", "a", "b"],
    ["status", "--summary"],
    ["media", "extra"],
  ])
    expect(() => prepareQueryCommand(parseArguments(args))).toThrow();
});
it("dispatches make before querying, prints revision-only output, and keeps failed make from querying", async () => {
  const root = await mkdtemp(join(tmpdir(), "sidecut-cli-queries-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const seen: { operation: string; body: Record<string, unknown> }[] = [];
  let failed = false;
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const operation = request.url!.split("/").at(-1)!;
    seen.push({ operation, body: JSON.parse(body) });
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify(
        operation === "schema"
          ? {
              operations: {
                status: {},
                transcript: { id: "string" },
                search: { phrase: "string", limit: "signedInteger" },
              },
            }
          : operation === "status"
            ? { revision: 7 }
            : operation === "transcribe"
              ? {
                  files: [{ mediaID: "m", state: failed ? "failed" : "ready" }],
                  waited: { pending: [] },
                }
              : contract.transcript.result,
      ),
    );
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  cleanups.push(
    () =>
      new Promise<void>((done, reject) =>
        server.close((error) => (error ? reject(error) : done())),
      ),
  );
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No server");
  const discovery = join(root, "endpoint.json");
  await writeFile(discovery, JSON.stringify({ port: address.port, token: "a".repeat(64) }));
  const cli = (...args: string[]) =>
    new Promise<{ code: number | null; out: string; err: string }>((done, reject) => {
      const child = spawn(
        process.execPath,
        [resolve("scripts/sidecut-cli.mjs"), ...args, "--endpoint-file", discovery],
        {
          cwd: root,
          env: {
            ...process.env,
            ELECTRON_RUN_AS_NODE: "1",
            SIDECUT_PROJECT: "",
            TANDEM_PROJECT: "",
          },
          windowsHide: true,
        },
      );
      let out = "",
        err = "";
      child.stdout.on("data", (v) => (out += v));
      child.stderr.on("data", (v) => (err += v));
      child.on("error", reject);
      child.on("close", (code) => done({ code, out, err }));
    });
  expect(await cli("status", "--revision")).toMatchObject({ code: 0, out: "7\n", err: "" });
  seen.length = 0;
  expect(await cli("transcript", "m", "--make", "--timeout", "0")).toMatchObject({
    code: 0,
    out: contract.transcript.text + "\n",
  });
  expect(seen.map((v) => v.operation)).toEqual(["schema", "transcribe", "transcript"]);
  expect(seen[1]?.body).toEqual({ media: ["m"], wait: true, timeout: 0 });
  failed = true;
  seen.length = 0;
  expect((await cli("transcript", "m", "--make", "--json")).code).toBe(1);
  expect(seen.some((v) => v.operation === "transcript")).toBe(false);
  const missingPhrase = await cli("search");
  expect(missingPhrase.code).toBe(2);
  expect(missingPhrase.err).toContain("Error: search needs a phrase.");
  const jsonFailure = await cli("search", "--json");
  expect(JSON.parse(jsonFailure.err)).toHaveProperty("error.code", "cliError");
  seen.length = 0;
  expect((await cli("search", "Hello", "world", "--limit", "-1", "--json")).code).toBe(0);
  expect(seen.at(-1)?.body).toEqual({ phrase: "Hello world", limit: -1 });
});
