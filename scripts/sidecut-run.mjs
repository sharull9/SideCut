#!/usr/bin/env node
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
/** Execute an explicitly supplied local script; this is a code runner, not an input-expression parser. */
export async function runScript(args) {
  const [project, script, code, ...extra] = args;
  if (
    !project ||
    !script ||
    extra.length ||
    (script === "-e" ? code === undefined : code !== undefined)
  )
    throw new Error("Usage: sidecut run <project.tandem | folder> <script.ts | -e CODE | ->");
  let moduleURL = new URL("./sdk/node.mjs", import.meta.url);
  try {
    await access(moduleURL);
  } catch {
    moduleURL = new URL("../packages/client/dist/node.mjs", import.meta.url);
  }
  const sdk = await import(moduleURL.href);
  let invoke;
  if (script === "-e" || script === "-") {
    let body = code ?? "";
    if (script === "-")
      for await (const chunk of process.stdin) {
        body += chunk.toString();
        if (body.length > 1024 * 1024)
          throw new Error("Inline scripts must be smaller than 1 MiB.");
      }
    const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
    const inner = new AsyncFunction("t", "cmd", "fixCaptionWords", "sdk", body);
    invoke = (client) => inner(client, sdk.cmd, sdk.fixCaptionWords, sdk);
  } else {
    invoke = (await import(pathToFileURL(resolve(script)).href)).default;
    if (typeof invoke !== "function")
      throw new Error("Script must default-export a function (t, sdk) => result.");
  }
  const controller = new AbortController(),
    stop = () => controller.abort();
  process.once("SIGINT", stop);
  const client = await sdk.openProjectClient(project, { signal: controller.signal });
  try {
    const result = await invoke(client, sdk);
    if (result !== undefined)
      process.stdout.write((typeof result === "string" ? result : JSON.stringify(result)) + "\n");
  } finally {
    process.removeListener("SIGINT", stop);
    await client.close();
  }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  runScript(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`error: ${error.message}\n`);
    process.exitCode = error.name === "AbortError" ? 130 : 1;
  });
