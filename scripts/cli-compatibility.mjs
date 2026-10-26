import { access, lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { delimiter, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export async function installCompatibilityLauncher(binDir) {
  if (typeof binDir !== "string" || !binDir.trim())
    throw new Error("install-compat needs --bin-dir with an explicit destination.");
  const windows = process.platform === "win32",
    folder = resolve(binDir),
    destination = join(folder, windows ? "tandem.cmd" : "tandem"),
    entry = fileURLToPath(new URL("./sidecut-cli.mjs", import.meta.url)),
    batch = (value) => `"${value.replaceAll("%", "%%")}"`,
    shell = (value) => "'" + value.replaceAll("'", "'\\''") + "'",
    content = windows
      ? `@echo off\r\nsetlocal DisableDelayedExpansion\r\nset "ELECTRON_RUN_AS_NODE=1"\r\n${batch(process.execPath)} ${batch(entry)} %*\r\n`
      : `#!/bin/sh\nexport ELECTRON_RUN_AS_NODE=1\nexec ${shell(process.execPath)} ${shell(entry)} "$@"\n`;
  const info = await lstat(destination).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
  const identical =
    info?.isFile() && !info.isSymbolicLink() && (await readFile(destination, "utf8")) === content;
  if (info && !identical) throw new Error(`Refusing to replace existing command: ${destination}`);
  const names = windows
    ? [
        ...new Set([
          "",
          ".cmd",
          ".bat",
          ".exe",
          ".com",
          ".ps1",
          ...(process.env.PATHEXT ?? "").toLowerCase().split(";").filter(Boolean),
        ]),
      ].map((ext) => "tandem" + ext)
    : ["tandem"];
  const compare = (path) => (windows ? resolve(path).toLowerCase() : resolve(path));
  for (const directory of (process.env.PATH ?? "").split(delimiter).filter(Boolean))
    for (const name of names) {
      const candidate = join(directory.replace(/^"(.*)"$/, "$1"), name);
      if (compare(candidate) === compare(destination) && identical) continue;
      const found = await lstat(candidate).catch((error) => {
        if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error;
      });
      if (!found || (!found.isFile() && !found.isSymbolicLink())) continue;
      if (!windows) {
        try {
          await access(candidate, constants.X_OK);
        } catch {
          continue;
        }
      }
      throw new Error(
        `The command tandem already exists on PATH: ${candidate}. Choose SideCut's named CLI or remove the collision yourself.`,
      );
    }
  if (identical) return { path: destination, installed: false, command: "tandem" };
  await access(entry);
  await mkdir(folder, { recursive: true });
  await writeFile(destination, content, { flag: "wx", mode: 0o755 });
  return { path: destination, installed: true, command: "tandem" };
}
