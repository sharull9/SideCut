import { afterEach, expect, it } from "vite-plus/test";
import { mkdtemp, mkdir, writeFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import contract from "../../../../tests/fixtures/tandem/segments-cli-foundation.json";
// JS CLI helpers are exercised without importing app startup or opening a network port.
import {
  parseArguments,
  findProject,
  discoverEndpoint,
  verifyProjectOwner,
} from "../../../../scripts/cli-foundation.mjs";
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function directory() {
  const root = await mkdtemp(join(tmpdir(), "sidecut-cli-foundation-"));
  roots.push(root);
  return root;
}
it("parses pinned invocation, aliases, repeated values and the option terminator", () => {
  for (const c of contract.parser) {
    const parsed = parseArguments(c.args);
    expect(parsed.words).toEqual(c.words);
    expect(Object.fromEntries(parsed.flags)).toEqual(c.flags);
  }
  for (const args of [["-x"], ["--at"], ["--json=true"], ["--name", "a", "--name", "b"]])
    expect(() => parseArguments(args)).toThrow();
});
it("finds explicit and environment projects, nearest parents and excludes render snapshots", async () => {
  const root = await directory(),
    nested = join(root, "a", "b"),
    file = join(root, "edit.tandem");
  await mkdir(nested, { recursive: true });
  await writeFile(file, "{}");
  for (const name of contract.discovery.renderSnapshots) await writeFile(join(root, name), "{}");
  expect(await findProject(undefined, nested, {})).toBe(await realpath(file));
  expect(await findProject(root, nested, {})).toBe(await realpath(file));
  expect(await findProject(undefined, nested, { TANDEM_PROJECT: file })).toBe(await realpath(file));
  await writeFile(join(root, "second.tandem"), "{}");
  await expect(findProject(undefined, nested, {})).rejects.toThrow(contract.discovery.ambiguity);
  expect(await findProject(file, nested, {})).toBe(await realpath(file));
});
it("keeps profiles and project owners separate and never opens a closed project headlessly", async () => {
  const root = await directory(),
    project = join(root, "edit.tandem"),
    other = join(root, "other.tandem"),
    endpoint = join(root, "profile.json");
  await writeFile(project, "{}");
  await writeFile(other, "{}");
  const flags = new Map([
    ["project", project],
    ["endpoint-file", endpoint],
  ]);
  const address = { port: 12345, token: "a".repeat(64), pid: process.pid };
  await writeFile(endpoint, JSON.stringify(address));
  expect((await discoverEndpoint(flags, {}, root)).endpoint).toEqual(address);
  await expect(verifyProjectOwner(await realpath(project), { path: other })).rejects.toThrow(
    "different project",
  );
  await expect(
    verifyProjectOwner(await realpath(project), { path: project }),
  ).resolves.toBeUndefined();
  await expect(discoverEndpoint(new Map([["project", project]]), {}, root)).rejects.toThrow(
    "Headless editing is unsupported",
  );
  await writeFile(endpoint, JSON.stringify({ ...address, token: "secret" }));
  await expect(discoverEndpoint(flags, {}, root)).rejects.toThrow("Invalid discovery file");
  await writeFile(endpoint, JSON.stringify({ ...address, pid: 2147483647 }));
  await expect(discoverEndpoint(flags, {}, root)).rejects.toThrow("no longer running");
});
it("serves help and version without project discovery or authentication", async () => {
  const root = await directory();
  for (const args of [["help", "segments"], ["segments", "-h"], ["-v"]]) {
    const result = await new Promise<{ code: number | null; out: string; err: string }>(
      (complete, reject) => {
        const child = spawn(process.execPath, [resolve("scripts/sidecut-cli.mjs"), ...args], {
          cwd: root,
          windowsHide: true,
        });
        let out = "",
          err = "";
        child.stdout.on("data", (c) => (out += c));
        child.stderr.on("data", (c) => (err += c));
        child.on("error", reject);
        child.on("close", (code) => complete({ code, out, err }));
      },
    );
    expect(result.code).toBe(0);
    expect(result.err).toBe("");
    expect(result.out).toMatch(/sidecut (segments|0.0.1)/);
  }
});
