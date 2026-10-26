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

/** Read the native SSE event stream. Disconnecting cancels this subscription only. */
export async function* watchHost(host, { signal, lastEventID } = {}) {
  const response = await fetch(`http://127.0.0.1:${host.port}/v1/watch`, {
    headers: {
      authorization: `Bearer ${host.token}`,
      accept: "text/event-stream",
      ...(lastEventID === undefined ? {} : { "last-event-id": String(lastEventID) }),
    },
    signal,
  });
  if (
    !response.ok ||
    !response.headers.get("content-type")?.startsWith("text/event-stream") ||
    !response.body
  )
    throw new Error(`Event stream could not open (${response.status}).`);
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let pending = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      pending += decoder.decode(value, { stream: true }).replaceAll("\r\n", "\n");
      if (pending.length > 1024 * 1024) throw new Error("Event stream frame exceeds 1 MiB.");
      let boundary;
      while ((boundary = pending.indexOf("\n\n")) >= 0) {
        const frame = pending.slice(0, boundary);
        pending = pending.slice(boundary + 2);
        const data = frame
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (!data) continue;
        const event = JSON.parse(data);
        if (!event || typeof event !== "object" || Array.isArray(event))
          throw new Error("Invalid event stream data.");
        yield event;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
