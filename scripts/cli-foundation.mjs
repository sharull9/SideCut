import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve, basename } from "node:path";

const switches = new Set(
  "json refresh words summary apply dry-run help version once portrait online optional keep-levels with-cache replace insert no-sounds pop changed quick cuts all default copy revision wait no-wait make widen mike gains audio-only ids no-place follow service".split(
    " ",
  ),
);
const repeatable = new Set(["search", "clips", "field", "value", "media", "tracks", "protect"]);
const aliases = { h: "help", v: "version", o: "output", expect: "expected-revision" };
export function parseArguments(args) {
  const flags = new Map(),
    words = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--") {
      words.push(...args.slice(i + 1));
      break;
    }
    if (!arg.startsWith("-") || /^-[\d.:]+$/.test(arg)) {
      words.push(arg);
      continue;
    }
    const equal = arg.indexOf("="),
      short = !arg.startsWith("--");
    let key = arg.slice(short ? 1 : 2, equal < 0 ? undefined : equal);
    if (short && !Object.hasOwn(aliases, key)) throw new Error(`Unknown option ${arg}.`);
    key = aliases[key] ?? key;
    let value;
    if (switches.has(key)) {
      if (equal >= 0) throw new Error(`--${key} doesn't take a value.`);
      value = true;
    } else {
      value = equal >= 0 ? arg.slice(equal + 1) : args[++i];
      if (value === undefined || (equal < 0 && value.startsWith("--")))
        throw new Error(`--${key} needs a value.`);
    }
    if (flags.has(key) && !switches.has(key) && !repeatable.has(key))
      throw new Error(`Duplicate option --${key}.`);
    if (repeatable.has(key)) flags.set(key, [...(flags.get(key) ?? []), value]);
    else flags.set(key, value);
  }
  return { flags, words };
}

// ProjectLocator at the pinned revision: explicit path, environment, nearest parent;
// rendered .mp4/.mov/.m4v.tandem snapshots never become the editing target.
export async function findProject(path, directory = process.cwd(), env = process.env) {
  const explicit = path ?? env.SIDECUT_PROJECT ?? env.TANDEM_PROJECT;
  const single = async (folder, required) => {
    const entries = await readdir(folder, { withFileTypes: true });
    const projects = entries
      .filter(
        (e) =>
          e.isFile() && e.name.endsWith(".tandem") && !/\.(mp4|mov|m4v)\.tandem$/i.test(e.name),
      )
      .map((e) => e.name)
      .sort();
    if (projects.length > 1)
      throw new Error(
        `${folder} has ${projects.length} projects (${projects.join(", ")}). Pick one with --project.`,
      );
    if (projects.length) return realpath(join(folder, projects[0]));
    if (required) throw new Error(`No .tandem project in ${folder}.`);
  };
  if (explicit) {
    const expanded =
      explicit === "~"
        ? homedir()
        : /^[~][\\/]/.test(explicit)
          ? join(homedir(), explicit.slice(2))
          : explicit;
    const target = resolve(directory, expanded);
    let info;
    try {
      info = await stat(target);
    } catch (error) {
      if (error.code !== "ENOENT" || !target.endsWith(".tandem")) throw error;
      // SQLite-backed hosts retain a logical project path plus an owner lock.
      await stat(`${target}.lock`);
      return join(await realpath(dirname(target)), basename(target));
    }
    return info.isDirectory() ? single(target, true) : realpath(target);
  }
  let folder = resolve(directory);
  for (;;) {
    const found = await single(folder, false);
    if (found) return found;
    const parent = dirname(folder);
    if (parent === folder) return undefined;
    folder = parent;
  }
}
export function defaultDiscoveryPath(env = process.env, platform = process.platform) {
  const base =
    platform === "win32"
      ? env.APPDATA
      : platform === "darwin"
        ? join(homedir(), "Library", "Application Support")
        : (env.XDG_CONFIG_HOME ?? join(homedir(), ".config"));
  if (!base)
    throw new Error("Set --endpoint-file or SIDECUT_API_FILE to the desktop discovery file.");
  return join(base, "sidecut", "current.tandem.api.json");
}
export async function discoverEndpoint(flags, env = process.env, directory = process.cwd()) {
  const project = await findProject(flags.get("project"), directory, env);
  const file =
    flags.get("endpoint-file") ??
    env.SIDECUT_API_FILE ??
    (project ? `${project}.api.json` : defaultDiscoveryPath(env));
  let endpoint;
  try {
    endpoint = JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT" && project)
      throw new Error(
        `No running owner for ${basename(project)}. Open it in SideCut or select its profile with --endpoint-file. Headless editing is unsupported.`,
        { cause: error },
      );
    throw error;
  }
  if (
    !endpoint ||
    !Number.isInteger(endpoint.port) ||
    endpoint.port < 1 ||
    endpoint.port > 65535 ||
    typeof endpoint.token !== "string" ||
    !/^[a-f0-9]{64}$/.test(endpoint.token) ||
    (endpoint.pid != null && (!Number.isInteger(endpoint.pid) || endpoint.pid <= 0))
  )
    throw new Error("Invalid discovery file.");
  if (endpoint.pid != null) {
    try {
      process.kill(endpoint.pid, 0);
    } catch {
      throw new Error(
        "The discovery file names an owner that is no longer running. Start SideCut and select the correct profile.",
      );
    }
  }
  return { endpoint, project };
}
export async function verifyProjectOwner(project, status) {
  if (!project) return;
  let owned;
  if (typeof status.path === "string") {
    try {
      owned = await realpath(status.path);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      owned = join(await realpath(dirname(status.path)), basename(status.path));
    }
  }
  if (owned !== project)
    throw new Error(
      "The selected endpoint owns a different project. Select the correct profile or --endpoint-file; no edit was sent.",
    );
}
export function commandHelp(topic) {
  if (topic === "segments" || ["save-segment", "insert-segment"].includes(topic))
    return `Usage: sidecut segments [list | save NAME | insert NAME] [options]
  save NAME --clips clip_a,clip_b | --from TIME --to TIME
            [--field clipID=Label ...] [--replace]
  insert NAME --at TIME [--value key=text ...] [--mode place|overwrite|insert]
              [--label TEXT] [--expect REVISION]
Times accept seconds or mm:ss.mmm. Default insert mode: place.
--project PATH selects a .tandem file or a folder containing exactly one.
--json prints JSON; --endpoint-file PATH selects an authenticated running profile.`;
  return undefined;
}

export function segmentText(operation, result) {
  const list = (items) =>
    items.length < 2 ? (items[0] ?? "") : items.slice(0, -1).join(", ") + " and " + items.at(-1);
  const line = (s) =>
    `${s.duration} s, ${s.clips} clip${s.clips === 1 ? "" : "s"} on ${list(s.tracks)}${s.fields.length ? `; asks for ${list(s.fields.map((f) => f.key))}` : ""}${s.missing.length ? `; MISSING ${s.missing.join(", ")}` : ""}`;
  if (operation === "segments") {
    const rows = result.segments.length
      ? [
          `Segments in ${result.folder} (${result.segments.length}):`,
          ...result.segments.map((s) => `  ${s.name}  ${line(s)}`),
          'Put one on the timeline with sidecut segments insert "<name>" --at <time> (--value key=text fills a field).',
        ]
      : [
          `No segments in ${result.folder} yet. Save one with sidecut segments save "Intro" --clips clip_a,clip_b.`,
        ];
    return [...rows, ...result.problems.map((p) => `Warning: ${p}`)].join("\n");
  }
  if (operation === "save-segment")
    return [
      `Saved the segment "${result.segment.name}" (${line(result.segment)}) to ${result.segment.folder}.`,
      result.copied.length
        ? `Copied beside it, so it stands on its own: ${result.copied.join(", ")}.`
        : "It plays no files, so nothing was copied.",
      ...result.notes.map((n) => `Note: ${n}`),
      `Insert it with sidecut segments insert "${result.segment.name}" --at <time>.`,
    ].join("\n");
  return [
    `Put the segment "${result.segment.name}" at ${result.at} s as revision ${result.applied.revision} (${result.segment.duration} s, one undo step).`,
    ...result.applied.warnings.map((w) => `Warning: ${w}`),
  ].join("\n");
}
