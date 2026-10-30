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

export function streamingOutputs(file: string, destination: string, caFile?: string) {
  const target = streamDestination(destination);
  const escape = (value: string) => value.replace(/[\\'|]/g, "\\$&");
  // Each slave option list has its own escaping level inside tee's output list.
  const option = (value: string) => value.replace(/[\\':]/g, "\\$&");
  const fifo = option("queue_size=120:drop_pkts_on_overflow=1:attempt_recovery=0");
  const network = `[f=flv:onfail=ignore:use_fifo=1:fifo_options=${fifo}:rw_timeout=3000000${target.secure ? `:tls_verify=1${caFile ? `:ca_file=${option(caFile)}` : ""}` : ""}]${target.url}`;
  return [
    "-flags",
    "+global_header",
    "-f",
    "tee",
    "-n",
    `[f=matroska:cluster_time_limit=1000:flush_packets=1]${escape(file)}|${escape(network)}`,
  ];
}
