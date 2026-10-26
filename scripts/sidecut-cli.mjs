#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { prepareProjectCommand, launchApplication } from "./cli-project-commands.mjs";
import { prepareQueryCommand, queryHelp } from "./cli-query-commands.mjs";
import { prepareApplyCommand } from "./cli-apply-command.mjs";
import { prepareRenderCommand } from "./cli-render-commands.mjs";
import { prepareResourceCommand } from "./cli-resource-commands.mjs";
import { prepareAnalysisCommand } from "./cli-analysis-commands.mjs";
import { prepareLibraryCommand } from "./cli-library-commands.mjs";
import { installCompatibilityLauncher } from "./cli-compatibility.mjs";
import { acquireProjectHost } from "./headless-host.mjs";
import { watchHost } from "./host-client.mjs";
import {
  parseArguments,
  verifyProjectOwner,
  findProject,
  commandHelp,
  segmentText,
} from "./cli-foundation.mjs";

const requestSchema = z.record(z.string(), z.unknown());
let closeHost = async () => {};
const numericFlagSchema = z.string().transform(Number).pipe(z.number());
const booleanFlagSchema = z
  .union([z.literal(true), z.enum(["true", "false"])])
  .transform((value) => value !== "false");

const help = `Usage: node scripts/sidecut-cli.mjs [project|assets|segments] COMMAND [options]

Connects to the running desktop host; query output is readable by default.
Use --json for machine-readable service results.
  --project PATH         File/folder, SIDECUT_PROJECT/TANDEM_PROJECT, or nearest parent
  -h, --help             Help (also: help segments)
  -v, --version          Version
  -o PATH                Alias for --output; --expect aliases --expected-revision
  --                     End options
Project discovery excludes render snapshots and rejects ambiguous folders.
Closed projects can use a hidden desktop host. An installed or built SideCut is required.
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
Automation: serve --project PATH; run PROJECT script.ts | -e CODE | - (stdin).
Assets: providers, search, fetch, show, use, credits, generate, install-starter.
Segments: list, save, insert.

Run schema for accepted fields and types. new/open/import replace the active
project and require --expected-revision. Network asset requests are opt-in.
Exit codes: 0 success, 2 invalid request, 3 unavailable, 4 stale revision,
5 not found, 6 unsupported. No request is retried automatically.`;

let readableQueryErrors = false;
async function main(args) {
  if (args[0] === "run") {
    const { runScript } = await import("./sidecut-run.mjs");
    return runScript(args.slice(1));
  }
  let { flags, words } = parseArguments(args);
  readableQueryErrors =
    !flags.has("json") && queryHelp(words[0] === "project" ? words[1] : words[0]) != null;
  if (flags.has("version") && !words.length) {
    process.stdout.write("sidecut 0.0.1\n");
    return;
  }
  if (words[0] === "serve" && !flags.has("help")) {
    if (words.length > 1) {
      if (words.length !== 2 || flags.has("project"))
        throw new Error("serve takes one project path.");
      flags.set("project", words[1]);
    }
    for (const flag of flags.keys())
      if (!["project", "endpoint-file", "json"].includes(flag))
        throw new Error(`Unknown serve option --${flag}.`);
    if (!(await findProject(flags.get("project")))) throw new Error("Choose a project to serve.");
    const host = await acquireProjectHost(flags);
    try {
      process.stdout.write(
        (flags.has("json")
          ? JSON.stringify({
              project: host.project,
              port: host.endpoint.port,
              pid: host.endpoint.pid,
            })
          : `Serving ${host.project} on 127.0.0.1:${host.endpoint.port}. Stop with Ctrl-C.`) + "\n",
      );
      await new Promise((done) => {
        const timer = setInterval(() => {}, 1000);
        const stop = () => {
          clearInterval(timer);
          process.removeListener("SIGINT", stop);
          process.removeListener("SIGTERM", stop);
          done();
        };
        process.once("SIGINT", stop);
        process.once("SIGTERM", stop);
      });
    } finally {
      await host.close();
    }
    return;
  }
  if (!words.length || words[0] === "help" || flags.has("help")) {
    const topic = words[0] === "help" ? words[1] : words[0];
    const detail = queryHelp(topic) ?? commandHelp(topic);
    if (words[0] === "help" && topic && !detail && !help.includes(topic))
      throw new Error(`Unknown help topic: ${topic}.`);
    process.stdout.write((detail ?? help) + "\n");
    if (!args.length) process.exitCode = 2;
    return;
  }
  if (
    (words[0] === "schema" || (words[0] === "project" && words[1] === "schema")) &&
    !flags.has("service")
  ) {
    if (words.length !== (words[0] === "project" ? 2 : 1))
      throw new Error("schema takes no arguments.");
    for (const flag of flags.keys())
      if (!["json", "endpoint-file"].includes(flag))
        throw new Error(`Unknown schema option --${flag}.`);
    process.stdout.write(
      await readFile(new URL("./edit-batch.schema.json", import.meta.url), "utf8"),
    );
    return;
  }
  if (flags.has("service") && !words.includes("schema"))
    throw new Error("--service requires schema.");
  flags.delete("service");
  if (words[0] === "install-compat") {
    if (words.length !== 1) throw new Error("install-compat takes no positional arguments.");
    for (const flag of flags.keys())
      if (!["bin-dir", "json"].includes(flag))
        throw new Error(`Unknown install-compat option --${flag}.`);
    const result = await installCompatibilityLauncher(flags.get("bin-dir"));
    process.stdout.write(
      (flags.has("json")
        ? JSON.stringify(result)
        : `${result.installed ? "Created" : "Already installed"}: ${result.path}. PATH is unchanged.`) +
        "\n",
    );
    return;
  }
  const queryCommand =
    (await prepareApplyCommand({ flags, words })) ??
    prepareLibraryCommand({ flags, words }) ??
    prepareAnalysisCommand({ flags, words }) ??
    prepareResourceCommand({ flags, words }) ??
    prepareRenderCommand({ flags, words }) ??
    prepareQueryCommand({ flags, words });
  if (queryCommand) {
    flags = queryCommand.flags;
    words = queryCommand.words;
  }
  if (queryCommand?.offline) {
    const result = await queryCommand.offline();
    process.stdout.write(
      (queryCommand.text ? queryCommand.text(result) : JSON.stringify(result)) + "\n",
    );
    return;
  }
  const projectCommand = prepareProjectCommand(args, { flags, words });
  if (projectCommand.flags) {
    flags = projectCommand.flags;
    words = projectCommand.words;
  }
  let operation = words[0];
  if (operation === "project") operation = words[1];
  else if (operation === "assets") operation = `assets-${words[1]}`;
  else if (operation === "segments")
    operation = { list: "segments", save: "save-segment", insert: "insert-segment" }[
      words[1] ?? "list"
    ];
  if (
    ["save-segment", "insert-segment"].includes(operation) &&
    words[0] === "segments" &&
    words[2] != null
  ) {
    if (flags.has("name")) throw new Error("Duplicate segment name.");
    flags.set("name", words[2]);
    words.splice(2, 1);
  }
  if (
    !operation ||
    !/^[a-z]+(?:-[a-z]+)*$/.test(operation) ||
    words.length > (["project", "assets", "segments"].includes(words[0]) ? 2 : 1)
  )
    throw new Error("Specify one command. Use --help.");
  if (operation === "save-segment" && flags.has("clips") && (flags.has("from") || flags.has("to")))
    throw new Error("Give --clips or --from and --to, not both.");
  let endpoint, project;
  try {
    const host = await acquireProjectHost(flags, {
      library: operation.startsWith("assets-") || operation === "segments",
    });
    ({ endpoint, project } = host);
    closeHost = host.close;
  } catch (error) {
    if (operation !== "app" || (error.code !== "ENOENT" && error.cause?.code !== "ENOENT"))
      throw error;
    const result = await launchApplication();
    process.stdout.write(
      (projectCommand.text ? projectCommand.text(result) : JSON.stringify(result)) + "\n",
    );
    return;
  }
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
      process.stderr.write(
        (readableQueryErrors
          ? `Error: ${result.error?.message ?? "Request failed."}`
          : JSON.stringify(result)) + "\n",
      );
      return null;
    }
    return result;
  };
  if (project) {
    const status = await call("status", {});
    if (!status) return;
    await verifyProjectOwner(project, status);
  }
  const schema = await call("schema", {});
  if (!schema) return;
  if (operation === "schema") {
    process.stdout.write(JSON.stringify(schema) + "\n");
    return;
  }
  if (!Object.hasOwn(schema.operations, operation))
    throw new Error(`Unknown command: ${operation}.`);
  if (queryCommand?.execute) {
    const result = await queryCommand.execute(call);
    if (result != null)
      process.stdout.write(
        (typeof result === "string"
          ? result
          : queryCommand.text
            ? queryCommand.text(result)
            : JSON.stringify(result)) + "\n",
      );
    return;
  }
  if (flags.has("request") && flags.has("input")) throw new Error("Choose --request or --input.");
  let input = flags.has("input")
    ? JSON.parse(await readFile(String(flags.get("input")), "utf8"))
    : flags.has("request")
      ? JSON.parse(String(flags.get("request")))
      : {};
  const request = requestSchema.safeParse(input);
  if (!request.success) throw new Error("Request must be a JSON object.");
  input = request.data;
  for (const [flag, raw] of flags) {
    if (["endpoint-file", "input", "request", "follow", "json", "project"].includes(flag)) continue;
    const fieldFlag = flag === "field" ? "fields" : flag === "value" ? "values" : flag;
    const key = Object.keys(schema.operations[operation]).find(
      (name) => name.toLowerCase() === fieldFlag.replaceAll("-", "").toLowerCase(),
    );
    if (!key) throw new Error(`Unknown option --${flag}.`);
    const type = schema.operations[operation][key];
    let value = raw;
    if (flag === "field") value = raw;
    else if (flag === "value") {
      value = Object.fromEntries(
        raw.map((pair) => {
          const equal = pair.indexOf("=");
          if (equal <= 0) throw new Error("--value takes key=text.");
          return [pair.slice(0, equal), pair.slice(equal + 1)];
        }),
      );
    } else if (type === "list")
      value = (Array.isArray(raw) ? raw : [String(raw)]).flatMap((v) =>
        v.startsWith("[") ? JSON.parse(v) : v.split(","),
      );
    else if (type === "stringMap") value = JSON.parse(String(raw));
    else if (type === "segmentFields")
      value = String(raw).startsWith("[") ? JSON.parse(String(raw)) : String(raw).split(",");
    else if (["strings", "times", "array"].includes(type))
      value = Array.isArray(raw)
        ? raw.flatMap((v) => (v.startsWith("[") ? JSON.parse(v) : v.split(",")))
        : JSON.parse(String(raw));
    else if (["integer", "signedInteger", "number"].includes(type)) {
      const parsed = numericFlagSchema.safeParse(raw);
      if (!parsed.success) throw new Error(`--${flag} needs a number.`);
      value = parsed.data;
    } else if (type === "boolean") {
      const parsed = booleanFlagSchema.safeParse(raw);
      if (!parsed.success) throw new Error(`--${flag} needs true or false.`);
      value = parsed.data;
    } else if (typeof raw !== "string") throw new Error(`--${flag} needs a value.`);
    if (Object.hasOwn(input, key)) throw new Error(`Duplicate request field ${key}.`);
    Object.defineProperty(input, key, { value, enumerable: true });
  }
  if (flags.has("follow") && operation !== "watch") throw new Error("--follow requires watch.");
  if (queryCommand) input = queryCommand.prepare(input);
  if (queryCommand?.make) {
    const made = await call("transcribe", {
      media: [input.id],
      wait: true,
      ...(queryCommand.timeout != null ? { timeout: queryCommand.timeout } : {}),
    });
    if (!made) return;
    if (
      made.ok === false ||
      made.files?.some((f) => ["failed", "cancelled"].includes(f.state)) ||
      made.waited?.pending?.length
    ) {
      process.exitCode = 1;
      process.stdout.write(
        (flags.has("json")
          ? JSON.stringify(made)
          : `Transcription is not ready.\n${(made.files ?? []).map((f) => `${f.mediaID}: ${f.state}${f.message ? ` (${f.message})` : ""}`).join("\n")}`) +
          "\n",
      );
      return;
    }
  }
  if (
    projectCommand.native &&
    ["new", "import-edl", "import-filmora"].includes(operation) &&
    input.expectedRevision == null
  ) {
    const status = await call("status", {});
    if (!status) return;
    input.expectedRevision = status.revision;
  }
  if (operation === "watch" && flags.has("follow")) {
    try {
      for await (const event of watchHost(endpoint, { signal: controller.signal })) {
        if (typeof event.kind !== "string") continue;
        const at = event.date ? new Date(event.date).toTimeString().slice(0, 8) : "--:--:--";
        let text;
        if (event.kind === "jobs") {
          const jobs = (event.jobs ?? []).filter((job) =>
            ["running", "queued"].includes(job.state),
          );
          text = `${at}  jobs: ${jobs.length ? jobs.map((job) => `${job.kind ?? job.label ?? "analysis"} ${job.mediaID ?? job.id} ${job.state}`).join(", ") : "idle"}`;
        } else if (event.kind === "export") {
          const job = event.export;
          text = `${at}  export ${String(job.output).split(/[\\/]/).at(-1)} ${job.state} ${Math.trunc(job.progress * 100)}%`;
        } else
          text = `${at}  r${event.revision ?? 0}  ${event.kind}  ${event.label ?? ""}  (${event.author ?? "?"})`;
        process.stdout.write((flags.has("json") ? JSON.stringify(event) : text) + "\n");
      }
    } catch (error) {
      if (!controller.signal.aborted) throw error;
    }
    return;
  }
  do {
    const result = await call(operation, input);
    if (!result) return;
    const output =
      ["segments", "save-segment", "insert-segment"].includes(operation) && !flags.has("json")
        ? segmentText(operation, result)
        : queryCommand?.text
          ? queryCommand.text(result)
          : projectCommand.text
            ? projectCommand.text(result)
            : JSON.stringify(result);
    if (output) process.stdout.write(output + "\n");
    if (["validate", "check", "wait", "transcribe"].includes(operation) && result.ok === false)
      process.exitCode = 1;
    if (!flags.has("follow")) return;
    input = { ...input, revision: result.revision, generation: result.generation };
    if (!result.changed) await new Promise((resolve) => setTimeout(resolve, 50));
  } while (!controller.signal.aborted);
}

main(process.argv.slice(2))
  .finally(() => closeHost())
  .catch((error) => {
    process.exitCode =
      error?.exitCode ??
      (error?.name === "AbortError" ? 130 : error?.message === "fetch failed" ? 3 : 2);
    // Discovery files contain credentials. Never echo their contents or network headers.
    const message =
      error?.name === "SyntaxError"
        ? "Invalid JSON input or discovery file."
        : error.code === "ENOENT"
          ? "File not found. Start Sidecut or set --endpoint-file."
          : error.message;
    process.stderr.write(
      (readableQueryErrors
        ? `Error: ${message}`
        : JSON.stringify({ error: { code: "cliError", message } })) + "\n",
    );
  });
