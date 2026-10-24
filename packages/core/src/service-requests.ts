import { QueryError, parseQueryTime } from "./project-queries";
import { object } from "./interchange";
import { Time } from "@sidecut/contracts/time";
const edit = {
  apply: "boolean",
  label: "string",
  author: "string",
  expectedRevision: "integer",
} as const;
const range = { from: "time", to: "time" } as const;
const image = { output: "string", format: "string" } as const;
export const rendererMutations = new Set(["relink", "assets-use", "insert-segment"]);
export const serviceDefinitions = {
  new: { name: "string", expectedRevision: "integer" },
  open: { path: "string", expectedRevision: "integer" },
  "import-edl": { path: "string", expectedRevision: "integer" },
  "import-filmora": { path: "string", expectedRevision: "integer", keepLevels: "boolean" },
  validate: {},
  check: { ...range, changed: "boolean", quick: "boolean", cuts: "boolean", width: "integer" },
  comments: {},
  watch: { revision: "integer", generation: "integer", timeout: "number" },
  wait: { what: "string", media: "strings", timeout: "number" },
  sync: {
    delay: "time",
    media: "strings",
    makeDefault: "boolean",
    files: "strings",
    to: "string",
    place: "boolean",
    dryRun: "boolean",
    label: "string",
    expectedRevision: "integer",
  },
  effects: { type: "string" },
  archive: { output: "string" },
  relink: { mediaID: "string", path: "string" },
  "assets-providers": {},
  "assets-search": {
    text: "string",
    kinds: "strings",
    providers: "strings",
    online: "boolean",
    limit: "integer",
    maxDuration: "number",
  },
  "assets-fetch": { id: "string", online: "boolean" },
  "assets-show": { id: "string" },
  "assets-use": {
    id: "string",
    at: "time",
    duration: "time",
    mode: "string",
    anchor: "string",
    pop: "boolean",
  },
  "assets-credits": { includeOptional: "boolean" },
  "assets-generate": {
    prompt: "string",
    kind: "string",
    duration: "number",
    variations: "integer",
    loop: "boolean",
    vocals: "boolean",
    confirmedPaid: "boolean",
  },
  "assets-install-starter": { online: "boolean" },
  segments: {},
  "save-segment": { name: "string", clipIDs: "strings", ...range },
  "insert-segment": { name: "string", at: "time", mode: "string" },
  apply: {
    commands: "array",
    label: "string",
    author: "string",
    expectedRevision: "integer",
    idempotencyKey: "string",
    dryRun: "boolean",
  },
  undo: { expectedRevision: "integer", count: "integer" },
  redo: { expectedRevision: "integer", count: "integer" },
  history: { limit: "integer" },
  diff: { since: "reference" },
  restore: {
    ...edit,
    from: "reference",
    clips: "strings",
    fromTime: "time",
    toTime: "time",
    track: "string",
  },
  transcript: { id: "string", ...range },
  transcribe: { media: "strings", wait: "boolean", timeout: "number", label: "string" },
  search: { phrase: "string", limit: "integer" },
  pauses: { ...range, min: "time" },
  tighten: {
    ...edit,
    ...range,
    min: "time",
    keep: "time",
    sentence: "time",
    comma: "time",
    mid: "time",
    midMin: "time",
    mike: "boolean",
    protect: "times",
    widen: "boolean",
  },
  join: { ...edit, ...range },
  captions: { ...edit, ...range, words: "integer", y: "number", track: "string" },
  short: { ...edit, copy: "boolean", copyPath: "string" },
  cards: {
    ...edit,
    markers: "strings",
    duration: "time",
    kicker: "string",
    track: "string",
    insert: "boolean",
    sounds: "boolean",
  },
  frame: { ...image, time: "time", maxWidth: "integer", maxHeight: "integer" },
  frames: { ...image, times: "times", every: "time", ...range, width: "integer" },
  screenshot: { output: "string" },
  clip: {
    start: "time",
    end: "time",
    output: "string",
    preset: "string",
    tracks: "strings",
    audioOnly: "boolean",
  },
  export: { ...range, ...image, preset: "string" },
  loudness: {
    ...range,
    mediaID: "string",
    step: "time",
    tracks: "strings",
    gains: "boolean",
    over: "number",
  },
} as const;
export const serviceFields: Record<string, Record<string, string>> = serviceDefinitions;
export const requiredServiceFields = {
  apply: ["commands"],
  diff: ["since"],
  restore: ["from"],
  search: ["phrase"],
  transcribe: ["media"],
  frame: ["time"],
  clip: ["start", "end"],
  new: ["expectedRevision"],
  open: ["path", "expectedRevision"],
  "import-edl": ["path", "expectedRevision"],
  "import-filmora": ["path", "expectedRevision"],
  "assets-fetch": ["id"],
  "assets-show": ["id"],
  "assets-use": ["id"],
  "save-segment": ["name"],
  "insert-segment": ["name", "at"],
} as const;
export const serviceRequired: Record<string, readonly string[]> = requiredServiceFields;
export function requestJsonSchema(
  fields: Record<string, string>,
  required: readonly string[] = [],
) {
  const field = (kind: string): object =>
    kind === "boolean"
      ? { type: "boolean" }
      : kind === "integer"
        ? { type: "integer", minimum: 0 }
        : kind === "number"
          ? { type: "number" }
          : kind === "time" || kind === "reference"
            ? { anyOf: [{ type: "number" }, { type: "string" }] }
            : ["array", "strings", "times"].includes(kind)
              ? {
                  type: "array",
                  items:
                    kind === "strings"
                      ? { type: "string" }
                      : kind === "times"
                        ? { anyOf: [{ type: "number" }, { type: "string" }] }
                        : { type: "object" },
                }
              : { type: "string" };
  return {
    type: "object" as const,
    properties: Object.fromEntries(Object.entries(fields).map(([key, kind]) => [key, field(kind)])),
    additionalProperties: false,
    required,
  };
}
export function serviceRequest(operation: string, input: unknown): Record<string, unknown> {
  const fields = Object.hasOwn(serviceFields, operation) ? serviceFields[operation] : undefined;
  if (!fields) throw new QueryError("notFound", `Unknown operation: ${operation}.`);
  const values = object(input),
    result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    const kind = Object.hasOwn(fields, key) ? fields[key] : undefined;
    if (!kind) throw new QueryError("badRequest", `Unknown ${operation} field: ${key}.`);
    if (value == null) continue;
    if (kind === "time") result[key] = parseQueryTime(value);
    else if (
      kind === "reference" &&
      (typeof value === "string" ||
        (typeof value === "number" && Number.isSafeInteger(value) && value >= 0))
    )
      result[key] = String(value);
    else if (
      kind === "integer" &&
      typeof value === "number" &&
      Number.isSafeInteger(value) &&
      value >= 0
    )
      result[key] = value;
    else if (kind === "number" && typeof value === "number" && Number.isFinite(value))
      result[key] = value;
    else if (kind === "array" && Array.isArray(value)) result[key] = value;
    else if (
      kind === "strings" &&
      Array.isArray(value) &&
      value.length <= 10000 &&
      value.every((v) => typeof v === "string" && v.length > 0)
    )
      result[key] = value;
    else if (kind === "times" && Array.isArray(value) && value.length <= 1000)
      result[key] = value.map((time) => parseQueryTime(time));
    else if ((kind === "string" || kind === "boolean") && typeof value === kind)
      result[key] = value;
    else throw new QueryError("badRequest", `Invalid ${key}.`);
  }
  for (const key of (Object.hasOwn(serviceRequired, operation) ? serviceRequired[operation] : []) ??
    [])
    if (result[key] === undefined) throw new QueryError("badRequest", `${key} is required.`);
  for (const [from, to] of [
    ["from", "to"],
    ["fromTime", "toTime"],
    ["start", "end"],
  ])
    if (
      result[from!] != null &&
      result[to!] != null &&
      (operation === "frames" && from === "from"
        ? Number(result[to!]) < Number(result[from!])
        : Number(result[to!]) <= Number(result[from!]))
    )
      throw new QueryError("badRequest", `${to} must follow ${from}.`);
  if (
    operation === "transcribe" &&
    result.timeout != null &&
    (Number(result.timeout) <= 0 || Number(result.timeout) > 600)
  )
    throw new QueryError(
      "badRequest",
      "Transcription timeout must be between zero and 600 seconds.",
    );
  return result;
}

export function inspectionTimes(request: Record<string, unknown>, duration: number) {
  const times = [...((request.times as number[] | undefined) ?? [])];
  if (request.every != null) {
    const every = Time.fromSeconds(Number(request.every)),
      start = Time.fromSeconds(Number(request.from ?? 0)),
      end = Time.fromSeconds(Number(request.to ?? duration));
    if (every.flicks <= 0n || end.flicks < start.flicks)
      throw new QueryError("badRequest", "Invalid contact-sheet interval.");
    for (let i = 0; i <= 192; i++) {
      const time = new Time(start.flicks + every.flicks * BigInt(i));
      if (time.flicks > end.flicks || (time.flicks === end.flicks && request.to == null)) break;
      times.push(time.seconds);
    }
  } else if (request.from != null || request.to != null)
    throw new QueryError("badRequest", "from and to require every for a contact sheet.");
  const result = [...new Set(times)].sort((a, b) => a - b);
  if (!result.length || result.length > 48 || result.some((time) => time < 0 || time > duration))
    throw new QueryError("badRequest", "Select 1-48 frame times inside the timeline.");
  return result;
}
