import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, access, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import {
  discoverEndpoint,
  defaultDiscoveryPath,
  findProject,
  verifyProjectOwner,
} from "./cli-foundation.mjs";
import { hostCall } from "./host-client.mjs";

const owners = new Set();
process.once("beforeExit", () => {
  for (const owner of owners) void owner();
});
function executable() {
  if (process.env.SIDECUT_APP_EXECUTABLE)
    return { file: process.env.SIDECUT_APP_EXECUTABLE, args: [] };
  if (/^sidecut(?:\.exe)?$/i.test(process.execPath.split(/[\\/]/).at(-1)))
    return { file: process.execPath, args: [] };
  let root = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(join(root, "apps/desktop/package.json")) && dirname(root) !== root)
    root = dirname(root);
  const desktop = join(root, "apps/desktop");
  const require = createRequire(join(desktop, "package.json"));
  try {
    return { file: require("electron"), args: [desktop] };
  } catch {
    throw new Error("Install SideCut or set SIDECUT_APP_EXECUTABLE to use headless hosting.");
  }
}
/** Reuse the authoritative owner, or acquire its existing file lock in a hidden desktop host. */
export async function acquireProjectHost(flags, { library = false, signal } = {}) {
  let found,
    child,
    profile,
    closed = false,
    lease;
  const storage = dirname(defaultDiscoveryPath());
  try {
    found = await discoverEndpoint(flags);
  } catch (error) {
    if (
      flags.has("endpoint-file") ||
      process.env.SIDECUT_API_FILE ||
      (error.code !== "ENOENT" && error.cause?.code !== "ENOENT")
    )
      throw error;
    let project = await findProject(flags.get("project"));
    if (!project && library) {
      project = join(storage, "library", "current.tandem");
      await mkdir(dirname(project), { recursive: true });
      await writeFile(
        project,
        JSON.stringify({
          revision: 0,
          project: { id: "prj_shared_library", name: "Shared library" },
        }),
        { flag: "wx", mode: 0o600 },
      ).catch((cause) => {
        if (cause.code !== "EEXIST") throw cause;
      });
    }
    if (!project) throw error;
    // Library calls discover the same persistent library owner even outside a project folder.
    try {
      found = await discoverEndpoint(new Map([["project", project]]));
    } catch {
      found = undefined;
    }
    if (!found) {
      const launch = executable();
      if (launch.args.length) await access(resolve(launch.args[0], "dist/main.mjs"));
      profile = await mkdtemp(join(tmpdir(), "sidecut-headless-"));
      const env = { ...process.env };
      delete env.ELECTRON_RUN_AS_NODE;
      child = spawn(
        launch.file,
        [
          ...launch.args,
          `--headless-project=${project}`,
          `--headless-profile=${profile}`,
          `--headless-storage-root=${storage}`,
          `--headless-parent=${process.pid}`,
        ],
        {
          env,
          stdio: [
            "ignore",
            "ignore",
            process.env.SIDECUT_HEADLESS_DIAGNOSTICS ? "inherit" : "ignore",
          ],
          windowsHide: true,
        },
      );
      child.unref();
      let launchError;
      child.once("error", (cause) => {
        launchError = cause;
      });
      try {
        const until = Date.now() + 60000;
        while (Date.now() < until) {
          signal?.throwIfAborted();
          if (launchError) throw launchError;
          try {
            found = await discoverEndpoint(new Map([["project", project]]));
            if (found.endpoint.headless) {
              const value = await hostCall(found.endpoint, "host-lease", {}, signal);
              lease = value.lease;
              break;
            }
          } catch {
            /* A lock prevents duplicate ownership while the renderer starts. */
          }
          if (child.exitCode !== null || child.signalCode !== null)
            throw new Error(
              `Headless host could not start (exit ${child.exitCode}, signal ${child.signalCode}).`,
              { cause: error },
            );
          await new Promise((done) => setTimeout(done, 100));
        }
        if (!lease || !found)
          throw new Error("Headless host did not become ready within 60 seconds.", {
            cause: error,
          });
      } catch (cause) {
        child.kill();
        throw cause;
      }
    }
  }
  if (found.project)
    await verifyProjectOwner(found.project, await hostCall(found.endpoint, "status", {}, signal));
  if (found.endpoint.headless && !lease)
    lease = (await hostCall(found.endpoint, "host-lease", {}, signal)).lease;
  const heartbeat = lease
    ? setInterval(() => {
        void hostCall(found.endpoint, "host-lease", { lease }).catch(() => {});
      }, 15000)
    : undefined;
  heartbeat?.unref();
  const close = async () => {
    if (closed) return;
    closed = true;
    owners.delete(close);
    clearInterval(heartbeat);
    const released = lease
      ? await hostCall(found.endpoint, "host-release", {
          lease,
          ownerReleased: Boolean(child),
        }).catch(() => undefined)
      : undefined;
    if (child && !(released?.leases > 0) && !released?.busy) {
      if (child.exitCode === null)
        await new Promise((done) => {
          const timer = setTimeout(() => {
            child.kill();
            done();
          }, 10000);
          child.once("exit", () => {
            clearTimeout(timer);
            done();
          });
        });
      if (profile && child.exitCode === 0) await rm(profile, { recursive: true, force: true });
    } else if (!child && found.endpoint.headless && released?.leases === 0 && !released.busy) {
      const until = Date.now() + 10000;
      while (Date.now() < until) {
        try {
          process.kill(found.endpoint.pid, 0);
        } catch {
          break;
        }
        await new Promise((done) => setTimeout(done, 50));
      }
    }
  };
  owners.add(close);
  return { ...found, close };
}
