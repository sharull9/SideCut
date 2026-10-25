// Native CLI conventions live here so the generic transport/parser can stay independent.
import { stat } from "node:fs/promises";
import { isAbsolute, basename } from "node:path";
import { spawn } from "node:child_process";

export async function launchApplication() {
  const executable =
    process.env.SIDECUT_APP_EXECUTABLE ??
    (/^sidecut(?:\.exe)?$/i.test(basename(process.execPath)) ? process.execPath : undefined);
  if (
    !executable ||
    !isAbsolute(executable) ||
    !(await stat(executable).catch(() => null))?.isFile()
  ) {
    const error = new Error(
      "No running editor was found. Set SIDECUT_APP_EXECUTABLE to an installed SideCut executable, or start SideCut first.",
    );
    error.exitCode = 3;
    throw error;
  }
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  await new Promise((resolve, reject) => {
    const child = spawn(executable, [], {
      env,
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
  return { opened: true, launched: true };
}

export function prepareProjectCommand(args) {
  const offset = args[0] === "project" ? 1 : 0;
  let command = args[offset];
  if (!["new", "app", "import", "import-edl", "import-filmora"].includes(command)) return { args };
  const words = [],
    flags = new Map();
  const switches = new Set(["json", "portrait", "keep-levels"]);
  for (let i = offset + 1; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith("--")) {
      words.push(arg);
      continue;
    }
    const [key, ...parts] = arg.slice(2).split("=");
    if (flags.has(key)) throw new Error(`Duplicate option --${key}.`);
    const value = parts.length ? parts.join("=") : switches.has(key) ? true : args[++i];
    if (value === undefined || (typeof value === "string" && value.startsWith("--")))
      throw new Error(`--${key} needs a value.`);
    flags.set(key, value);
  }
  const native = command === "import" || command === "app" || words.length > 0;
  if (command === "import") {
    const kind = words.shift();
    if (!["edl", "filmora"].includes(kind)) throw new Error("import needs edl or filmora.");
    command = `import-${kind}`;
  }
  if (words.length > 1) throw new Error(`Unexpected arguments for ${command}.`);
  const unsupported = (message) => {
    const error = new Error(message);
    error.exitCode = 6;
    throw error;
  };
  if (command === "app")
    for (const key of flags.keys()) {
      if (!["json", "endpoint-file"].includes(key)) throw new Error(`Unknown app option --${key}.`);
    }
  if (command === "app" && words.length)
    unsupported(
      "app opens the running editor. Opening another project window is not supported; use guarded project open --path instead.",
    );
  for (const flag of ["search", "rewrite"])
    if (flags.has(flag)) unsupported(`--${flag} is not supported by the sandboxed host importer.`);
  if (command === "new") {
    if (flags.has("portrait")) {
      flags.set("width", "1080");
      flags.set("height", "1920");
      flags.delete("portrait");
    }
    if (flags.has("size")) {
      const match = /^(\d+)x(\d+)$/i.exec(String(flags.get("size")));
      if (!match || Number(match[1]) < 1 || Number(match[2]) < 1)
        throw new Error("--size takes positive width x height, like 1080x1920.");
      flags.set("width", match[1]);
      flags.set("height", match[2]);
      flags.delete("size");
    }
  }
  if (words.length) {
    if (flags.has("path")) throw new Error("Specify a positional path or --path, not both.");
    flags.set("path", words[0]);
  }
  if (command === "import-edl" && native && !flags.has("recipe"))
    throw new Error("import edl needs --recipe with a recipe JSON file.");
  if (command === "import-filmora" && native && !flags.has("path"))
    throw new Error("import filmora needs a .wfp source path.");
  for (const [from, to] of [
    ["expect", "expected-revision"],
    ["out", "output"],
  ]) {
    if (!flags.has(from)) continue;
    if (flags.has(to)) throw new Error(`Choose --${from} or --${to}.`);
    flags.set(to, flags.get(from));
    flags.delete(from);
  }
  return {
    native,
    args: [
      command,
      ...[...flags].flatMap(([key, value]) =>
        value === true ? [`--${key}`] : [`--${key}=${value}`],
      ),
    ],
    text:
      native && !flags.has("json")
        ? (result) => {
            if (command === "app") return "Opened SideCut.";
            if (command === "new")
              return `Created ${result.path ?? result.name}, ${result.width}x${result.height}, with ${result.tracks.length} tracks (${result.tracks.join(", ")}).\nMedia discovery is explicit: run media --refresh.`;
            return `Imported ${result.name}: ${result.report?.clips ?? 0} clips, ${result.report?.media ?? 0} media.\n${(result.report?.warnings ?? []).join("\n")}\n${result.path ? `Wrote ${result.path}` : "Loaded in the active editor."}`;
          }
        : undefined,
  };
}
