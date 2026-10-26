import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export async function discoverHost(path = process.env.SIDECUT_API_FILE) {
  if (!path) {
    const base =
      process.platform === "win32"
        ? process.env.APPDATA
        : process.platform === "darwin"
          ? join(homedir(), "Library", "Application Support")
          : (process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"));
    if (!base) throw new Error("Set SIDECUT_API_FILE to the desktop discovery file.");
    path = join(base, "sidecut", "current.tandem.api.json");
  }
  const raw = await readFile(path, "utf8");
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("Invalid discovery file.");
  }
  if (
    !value ||
    !Number.isInteger(value.port) ||
    value.port < 1 ||
    value.port > 65535 ||
    typeof value.token !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.token)
  )
    throw new Error("Invalid discovery file.");
  return value;
}
export async function hostCall(host, operation, input = {}, signal, author = "mcp") {
  if (!/^[a-z]+(?:-[a-z]+)*$/.test(operation)) throw new Error("Invalid operation.");
  const response = await fetch(`http://127.0.0.1:${host.port}/v1/${operation}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${host.token}`,
      "content-type": "application/json",
      "x-tandem-author": author,
    },
    body: JSON.stringify(input),
    signal,
  });
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error("Host returned an invalid JSON response.");
  }
  if (!response.ok) {
    const error = new Error(result.error?.message ?? "Host request failed.");
    error.code = result.error?.code ?? "unavailable";
    error.revision = result.error?.revision;
    throw error;
  }
  return result;
}
