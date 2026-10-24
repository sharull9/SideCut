#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const help = `Usage: node scripts/sidecut-cli.mjs [project|assets|segments] COMMAND [options]

Connects to the running desktop host; all output is JSON.
  --endpoint-file PATH    Discovery file (or SIDECUT_API_FILE)
  --input PATH           Read request JSON from a file
  --request JSON         Request object as JSON
  --field-name VALUE     Schema field; kebab-case becomes camelCase
  --follow               Repeat watch, resuming at the last revision
  --help                 Show this help

Commands: schema, status, media, timeline, clips, apply, undo, redo, history,
diff, restore, transcript, transcribe, search, pauses, tighten, join, captions,
short, cards, validate, check, comments, sync, watch, wait, effects, archive,
relink, frame, frames, screenshot, clip, export, loudness, new, open,
import-edl, import-filmora.
Assets: providers, search, fetch, show, use, credits, generate, install-starter.
Segments: list, save, insert.

Run schema for accepted fields and types. new/open/import replace the active
project and require --expected-revision. Network asset requests are opt-in.
Exit codes: 0 success, 2 invalid request, 3 unavailable, 4 stale revision,
5 not found, 6 unsupported. No request is retried automatically.`;

function discoveryPath() {
  const base =
    process.platform === "win32"
      ? process.env.APPDATA
      : process.platform === "darwin"
        ? join(homedir(), "Library", "Application Support")
        : (process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"));
  if (!base)
    throw new Error("Set --endpoint-file or SIDECUT_API_FILE to the desktop discovery file.");
  return join(base, "sidecut", "current.tandem.api.json");
}

async function main(args) {
  if (!args.length || args.includes("--help")) {
    process.stdout.write(help + "\n");
    return;
  }
  const flags = new Map(),
    words = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith("--")) {
      words.push(arg);
      continue;
    }
    const equal = arg.indexOf("="),
      key = equal < 0 ? arg.slice(2) : arg.slice(2, equal);
    if (flags.has(key)) throw new Error(`Duplicate option --${key}.`);
    const value =
      equal >= 0
        ? arg.slice(equal + 1)
        : args[i + 1] && !args[i + 1].startsWith("--")
          ? args[++i]
          : true;
    flags.set(key, value);
  }
  let operation = words[0];
  if (operation === "project") operation = words[1];
  else if (operation === "assets") operation = `assets-${words[1]}`;
  else if (operation === "segments")
    operation = { list: "segments", save: "save-segment", insert: "insert-segment" }[words[1]];
  if (
    !operation ||
    !/^[a-z]+(?:-[a-z]+)*$/.test(operation) ||
    words.length > (["project", "assets", "segments"].includes(words[0]) ? 2 : 1)
  )
    throw new Error("Specify one command. Use --help.");
  const endpointFile =
    flags.get("endpoint-file") ?? process.env.SIDECUT_API_FILE ?? discoveryPath();
  if (typeof endpointFile !== "string") throw new Error("--endpoint-file needs a path.");
  const endpoint = JSON.parse(await readFile(endpointFile, "utf8"));
  if (
    !endpoint ||
    !Number.isInteger(endpoint.port) ||
    endpoint.port < 1 ||
    endpoint.port > 65535 ||
    typeof endpoint.token !== "string" ||
    !/^[a-f0-9]{64}$/.test(endpoint.token)
  )
    throw new Error("Invalid discovery file.");
  const controller = new AbortController();
  process.once("SIGINT", () => controller.abort());
  const call = async (name, input) => {
    const response = await fetch(`http://127.0.0.1:${endpoint.port}/v1/${name}`, {
      method: "POST",
      headers: { authorization: `Bearer ${endpoint.token}`, "content-type": "application/json" },
      body: JSON.stringify(input),
      signal: controller.signal,
    });
    const result = await response.json();
    if (!response.ok) {
      process.exitCode =
        { unavailable: 3, staleRevision: 4, notFound: 5, notImplemented: 6 }[result.error?.code] ??
        2;
      process.stderr.write(JSON.stringify(result) + "\n");
      return null;
    }
    return result;
  };
  const schema = await call("schema", {});
  if (!schema) return;
  if (operation === "schema") {
    process.stdout.write(JSON.stringify(schema) + "\n");
    return;
  }
  if (!Object.hasOwn(schema.operations, operation))
    throw new Error(`Unknown command: ${operation}.`);
  if (flags.has("request") && flags.has("input")) throw new Error("Choose --request or --input.");
  let input = flags.has("input")
    ? JSON.parse(await readFile(String(flags.get("input")), "utf8"))
    : flags.has("request")
      ? JSON.parse(String(flags.get("request")))
      : {};
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Request must be a JSON object.");
  for (const [flag, raw] of flags) {
    if (["endpoint-file", "input", "request", "follow", "json"].includes(flag)) continue;
    const key = Object.keys(schema.operations[operation]).find(
      (name) => name.toLowerCase() === flag.replaceAll("-", "").toLowerCase(),
    );
    if (!key) throw new Error(`Unknown option --${flag}.`);
    const type = schema.operations[operation][key];
    let value = raw;
    if (["strings", "times", "array"].includes(type)) value = JSON.parse(String(raw));
    else if (["integer", "number"].includes(type)) {
      value = Number(raw);
      if (raw === true || !Number.isFinite(value)) throw new Error(`--${flag} needs a number.`);
    } else if (type === "boolean") {
      if (![true, "true", "false"].includes(raw)) throw new Error(`--${flag} needs true or false.`);
      value = raw !== "false";
    } else if (typeof raw !== "string") throw new Error(`--${flag} needs a value.`);
    if (Object.hasOwn(input, key)) throw new Error(`Duplicate request field ${key}.`);
    Object.defineProperty(input, key, { value, enumerable: true });
  }
  if (flags.has("follow") && operation !== "watch") throw new Error("--follow requires watch.");
  do {
    const result = await call(operation, input);
    if (!result) return;
    process.stdout.write(JSON.stringify(result) + "\n");
    if (!flags.has("follow")) return;
    input = { ...input, revision: result.revision, generation: result.generation };
  } while (!controller.signal.aborted);
}

main(process.argv.slice(2)).catch((error) => {
  process.exitCode = error?.name === "AbortError" ? 130 : error?.message === "fetch failed" ? 3 : 2;
  // Discovery files contain credentials. Never echo their contents or network headers.
  process.stderr.write(
    JSON.stringify({
      error: {
        code: "cliError",
        message:
          error?.name === "SyntaxError"
            ? "Invalid JSON input or discovery file."
            : error.code === "ENOENT"
              ? "File not found. Start Sidecut or set --endpoint-file."
              : error.message,
      },
    }) + "\n",
  );
});
