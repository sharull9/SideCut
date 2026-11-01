/** Reject tee syntax as well as non-RTMP destinations before reaching FFmpeg. */
export function streamDestination(value: unknown): { url: string; label: string; secure: boolean } {
  if (
    typeof value !== "string" ||
    value.length > 2048 ||
    !/^rtmps?:\/\/[a-zA-Z0-9:/?&=._~%+@!$(),;-]+$/.test(value)
  )
    throw new Error("Invalid RTMP/RTMPS destination.");
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Invalid RTMP/RTMPS destination.");
  }
  if (
    !parsed.hostname ||
    parsed.username ||
    parsed.password ||
    parsed.hash ||
    parsed.pathname === "/" ||
    !parsed.pathname
  )
    throw new Error(
      "Destination needs a host and stream path, without embedded login credentials.",
    );
  return {
    url: value,
    label: `${parsed.protocol}//${parsed.host}`,
    secure: parsed.protocol === "rtmps:",
  };
}

export function streamDestinations(single: unknown, multiple: unknown): string[] {
  if (single !== undefined && multiple !== undefined)
    throw new Error("Use one destination field, not both.");
  if (
    multiple !== undefined &&
    (!Array.isArray(multiple) || multiple.length < 1 || multiple.length > 4)
  )
    throw new Error("Streaming supports one to four destinations.");
  const values: unknown[] = Array.isArray(multiple)
    ? multiple
    : single === undefined
      ? []
      : [single];
  const urls = values.map((value) => streamDestination(value).url);
  if (new Set(urls.map((url) => new URL(url).href)).size !== urls.length)
    throw new Error("Duplicate streaming destination.");
  return urls;
}

export function streamingOutputs(file: string, destination: string | string[], caFile?: string) {
  const targets = streamDestinations(
    undefined,
    typeof destination === "string" ? [destination] : destination,
  ).map(streamDestination);
  const escape = (value: string) => value.replace(/[\\'|]/g, "\\$&");
  // Each slave option list has its own escaping level inside tee's output list.
  const option = (value: string) => value.replace(/[\\':]/g, "\\$&");
  const fifo = option(
    "queue_size=120:drop_pkts_on_overflow=1:attempt_recovery=1:max_recovery_attempts=3:recovery_wait_time=1:restart_with_keyframe=1",
  );
  const networks = targets.map(
    (target) =>
      `[f=flv:onfail=ignore:use_fifo=1:fifo_options=${fifo}:rw_timeout=3000000${target.secure ? `:tls_verify=1${caFile ? `:ca_file=${option(caFile)}` : ""}` : ""}]${target.url}`,
  );
  return [
    "-flags",
    "+global_header",
    "-f",
    "tee",
    "-n",
    `[f=matroska:cluster_time_limit=1000:flush_packets=1]${escape(file)}|${networks.map(escape).join("|")}`,
  ];
}
