import { expect, it } from "vite-plus/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NativeProjectStore } from "./project-store.ts";
import { DatabaseSync } from "node:sqlite";

it("reclaims a lock only after its owner has exited and still excludes concurrent hosts", async () => {
  const root = await mkdtemp(join(tmpdir(), "sidecut-dead-owner-"));
  const path = join(root, "current.tandem"),
    first = new NativeProjectStore(path),
    second = new NativeProjectStore(path);
  try {
    await promisify(execFile)(process.execPath, [
      "-e",
      "require('node:fs').writeFileSync(process.argv[1], JSON.stringify({pid:process.pid,token:'dead-owner'}))",
      `${path}.lock`,
    ]);
    await first.acquire();
    await expect(second.acquire()).rejects.toThrow("locked");
    expect(JSON.parse(await readFile(`${path}.lock`, "utf8")).pid).toBe(process.pid);
    await first.close();
    await second.acquire();
  } finally {
    await first.close();
    await second.close();
    await rm(root, { recursive: true, force: true });
  }
});

it("preserves malformed and live-owner locks", async () => {
  const root = await mkdtemp(join(tmpdir(), "sidecut-live-owner-"));
  const path = join(root, "current.tandem"),
    store = new NativeProjectStore(path);
  try {
    for (const value of [
      "partial",
      JSON.stringify({ pid: process.pid, token: "live-owner" }),
      JSON.stringify({ pid: 0, token: "invalid" }),
    ]) {
      await writeFile(`${path}.lock`, value);
      await expect(store.acquire()).rejects.toThrow();
      expect(await readFile(`${path}.lock`, "utf8")).toBe(value);
    }
  } finally {
    await store.close();
    await rm(root, { recursive: true, force: true });
  }
});

it("does not reclaim a dead owner's file while another contender holds the recovery guard", async () => {
  const root = await mkdtemp(join(tmpdir(), "sidecut-recovery-guard-"));
  const path = join(root, "current.tandem"),
    store = new NativeProjectStore(path);
  const guard = new DatabaseSync(`${path}.lock.sqlite`);
  try {
    await promisify(execFile)(process.execPath, [
      "-e",
      "require('node:fs').writeFileSync(process.argv[1], JSON.stringify({pid:process.pid,token:'dead-owner'}))",
      `${path}.lock`,
    ]);
    const previous = await readFile(`${path}.lock`, "utf8");
    guard.exec("BEGIN IMMEDIATE");
    await expect(store.acquire()).rejects.toThrow("locked");
    expect(await readFile(`${path}.lock`, "utf8")).toBe(previous);
    guard.exec("ROLLBACK");
    await store.acquire();
  } finally {
    guard.close();
    await store.close();
    await rm(root, { recursive: true, force: true });
  }
});
