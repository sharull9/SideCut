import { afterEach, expect, it, vi } from "vite-plus/test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join, delimiter } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { installCompatibilityLauncher } from "../../../../scripts/cli-compatibility.mjs";
const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
it("requires explicit opt-in and refuses existing or PATH-colliding commands", async () => {
  await expect(installCompatibilityLauncher(undefined)).rejects.toThrow("explicit destination");
  const root = await mkdtemp(join(tmpdir(), "sidecut-compat-collision-"));
  roots.push(root);
  const existing = join(root, "existing");
  await mkdir(existing);
  const foreign = join(existing, process.platform === "win32" ? "tandem.cmd" : "tandem");
  await writeFile(foreign, "foreign command", { mode: 0o755 });
  vi.stubEnv("PATH", existing);
  await expect(installCompatibilityLauncher(join(root, "bin"))).rejects.toThrow(
    "already exists on PATH",
  );
  expect(await readFile(foreign, "utf8")).toBe("foreign command");
  vi.stubEnv("PATH", "");
  await expect(installCompatibilityLauncher(existing)).rejects.toThrow("Refusing to replace");
});
it("creates an idempotent launcher that runs the CLI with unchanged PATH", async () => {
  const root = await mkdtemp(join(tmpdir(), "sidecut-compat-"));
  roots.push(root);
  const bin = join(root, "bin");
  vi.stubEnv("PATH", "");
  const result = await installCompatibilityLauncher(bin);
  expect(result.installed).toBe(true);
  vi.stubEnv("PATH", bin + delimiter + join(root, "empty"));
  expect(await installCompatibilityLauncher(bin)).toEqual({ ...result, installed: false });
  const command =
      process.platform === "win32"
        ? join(process.env.SystemRoot ?? "C:/Windows", "System32/cmd.exe")
        : result.path,
    args = process.platform === "win32" ? ["/d", "/c", result.path, "--version"] : ["--version"];
  const run = await new Promise<{ code: number | null; out: string; err: string }>(
    (done, reject) => {
      const child = spawn(command, args, { windowsHide: true });
      let out = "",
        err = "";
      child.stdout.on("data", (v) => (out += v));
      child.stderr.on("data", (v) => (err += v));
      child.on("error", reject);
      child.on("close", (code) => done({ code, out, err }));
    },
  );
  expect(run.code, run.err).toBe(0);
  expect(run.out).toBe("sidecut 0.0.1\n");
  expect(process.env.PATH).toBe(bin + delimiter + join(root, "empty"));
});
