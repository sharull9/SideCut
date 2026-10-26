import { serviceDefinitions, type requiredServiceFields } from "@sidecut/core/service-requests";
import type { EditCommandInput } from "@sidecut/contracts/commands";
import type { queryDefinitions } from "@sidecut/core/project-queries";
import type { SegmentField } from "@sidecut/core/segments";
export type { EditCommand, EditBatch } from "@sidecut/contracts/commands";
export { cmd, type Command, type CommandName, type CommandArgs } from "./commands";
export { ProjectView, type ClipOn, type TransitionOn } from "./project-view";
export { fixCaptionWords } from "./captions";
export type { ApplyResult, StatusResult, TranscriptResult, Word } from "./results";
import { ProjectView } from "./project-view";
import {
  ApplyResultSchema,
  StatusResultSchema,
  TimelineResultSchema,
  TimelineTextSchema,
  TranscriptResultSchema,
  HistoryResultSchema,
  readResult,
  type ApplyResult,
} from "./results";
const authoredOperations = new Set(
  Object.entries(serviceDefinitions)
    .filter(([, fields]) => Object.hasOwn(fields, "author"))
    .map(([operation]) => operation),
);

type Value<T> = T extends "boolean"
  ? boolean
  : T extends "number" | "integer" | "signedInteger"
    ? number
    : T extends "time" | "reference"
      ? number | string
      : T extends "times"
        ? (number | string)[]
        : T extends "strings"
          ? string[]
          : T extends "list"
            ? string | string[]
            : T extends "stringMap"
              ? Record<string, string>
              : T extends "segmentFields"
                ? string | (string | SegmentField)[]
                : T extends "array"
                  ? EditCommandInput[]
                  : T extends "string"
                    ? string
                    : never;
type Definitions = typeof serviceDefinitions &
  typeof queryDefinitions & { schema: Record<string, never> };
export type ServiceOperation = keyof Definitions;
type OptionalRequest<K extends ServiceOperation> = {
  [P in keyof Definitions[K]]?: Value<Definitions[K][P]>;
};
type RequiredKeys<K extends ServiceOperation> = K extends keyof typeof requiredServiceFields
  ? Extract<(typeof requiredServiceFields)[K][number], keyof OptionalRequest<K>>
  : never;
export type ServiceRequest<K extends ServiceOperation> = OptionalRequest<K> &
  Required<Pick<OptionalRequest<K>, RequiredKeys<K>>>;
export class ServiceError extends Error {
  readonly code: string;
  readonly revision: number | undefined;
  constructor(code: string, message: string, revision?: number) {
    super(message);
    this.code = code;
    this.revision = revision;
  }
}
export class SideCutClient {
  revision: number | undefined;
  private readonly endpoint: { port: number; token: string };
  private readonly transport: typeof fetch;
  constructor(
    endpoint: { port: number; token: string },
    transport: typeof fetch = fetch,
    readonly author = "sdk",
  ) {
    if (
      !Number.isInteger(endpoint.port) ||
      endpoint.port < 1 ||
      endpoint.port > 65535 ||
      !/^[a-f0-9]{64}$/.test(endpoint.token)
    )
      throw new Error("Invalid host endpoint.");
    this.endpoint = { ...endpoint };
    this.transport = transport;
  }
  async call<K extends ServiceOperation>(
    operation: K,
    input: ServiceRequest<K>,
    signal?: AbortSignal,
  ): Promise<unknown> {
    if (!/^[a-z]+(?:-[a-z]+)*$/.test(operation))
      throw new ServiceError("invalid", "Invalid service operation.");
    const response = await this.transport(
      `http://127.0.0.1:${this.endpoint.port}/v1/${operation}`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.endpoint.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(
          authoredOperations.has(operation) &&
            !(operation === "relink" && ("mediaID" in input || "path" in input))
            ? { author: this.author, ...input }
            : input,
        ),
        ...(signal ? { signal } : {}),
      },
    );
    let result: unknown;
    try {
      result = await response.json();
    } catch {
      throw new ServiceError("unavailable", "Host returned an invalid JSON response.");
    }
    if (!response.ok) {
      if (
        result &&
        typeof result === "object" &&
        "error" in result &&
        result.error &&
        typeof result.error === "object" &&
        "code" in result.error &&
        typeof result.error.code === "string" &&
        "message" in result.error &&
        typeof result.error.message === "string"
      )
        throw new ServiceError(
          result.error.code,
          result.error.message,
          "revision" in result.error && typeof result.error.revision === "number"
            ? result.error.revision
            : undefined,
        );
      throw new ServiceError("unavailable", "Invalid host error response.");
    }
    if (
      result &&
      typeof result === "object" &&
      "revision" in result &&
      Number.isSafeInteger(result.revision) &&
      typeof result.revision === "number" &&
      result.revision >= 0 &&
      !("dryRun" in result && result.dryRun === true)
    )
      this.revision = result.revision;
    return result;
  }
  /** Repeating this exact request is safe: retain the idempotency key and expected revision. */
  apply(
    commands: EditCommandInput[],
    options: { expectedRevision: number; idempotencyKey: string; label?: string },
    signal?: AbortSignal,
  ) {
    return this.call("apply", { commands, ...options }, signal).then((result) =>
      readResult(ApplyResultSchema, result, "apply"),
    );
  }

  async status(signal?: AbortSignal) {
    return readResult(StatusResultSchema, await this.call("status", {}, signal), "status");
  }
  schema(signal?: AbortSignal) {
    return this.call("schema", {}, signal);
  }
  media(refresh = false, signal?: AbortSignal) {
    return this.call("media", { refresh }, signal);
  }
  search(phrase: string, signal?: AbortSignal) {
    return this.call("search", { phrase }, signal);
  }
  pauses(min = 0.6, signal?: AbortSignal) {
    return this.call("pauses", { min }, signal);
  }
  check(options: ServiceRequest<"check"> = {}, signal?: AbortSignal) {
    return this.call("check", options, signal);
  }
  frame(time: number | string, output?: string, signal?: AbortSignal) {
    return this.call("frame", { time, ...(output == null ? {} : { output }) }, signal);
  }
  frames(options: Omit<ServiceRequest<"frames">, "output">, output?: string, signal?: AbortSignal) {
    return this.call("frames", { ...options, ...(output == null ? {} : { output }) }, signal);
  }
  clip(start: number | string, end: number | string, output?: string, signal?: AbortSignal) {
    return this.call("clip", { start, end, ...(output == null ? {} : { output }) }, signal);
  }
  async transcript(id?: string, signal?: AbortSignal) {
    return readResult(
      TranscriptResultSchema,
      await this.call("transcript", id == null ? {} : { id }, signal),
      "transcript",
    );
  }
  async history(signal?: AbortSignal) {
    const result = readResult(
      HistoryResultSchema,
      await this.call("history", {}, signal),
      "history",
    );
    return result.events.length ? result.events : (result.edits ?? []);
  }
  async timelineText(
    options: Omit<ServiceRequest<"timeline">, "format"> = {},
    signal?: AbortSignal,
  ) {
    return readResult(
      TimelineTextSchema,
      await this.call("timeline", { ...options, format: "text" }, signal),
      "timeline",
    ).text;
  }
  async project(range: Pick<ServiceRequest<"timeline">, "from" | "to"> = {}, signal?: AbortSignal) {
    const result = readResult(
      TimelineResultSchema,
      await this.call("timeline", { ...range, format: "json" }, signal),
      "timeline",
    );
    return new ProjectView(result.project, result.revision);
  }
  async findWords(
    pattern: RegExp | string,
    options: { context?: number } = {},
    signal?: AbortSignal,
  ) {
    const context = options.context ?? 4;
    if (!Number.isInteger(context) || context < 0)
      throw new ServiceError("invalid", "Word context must be a nonnegative integer.");
    const { words } = await this.transcript(undefined, signal);
    const matcher =
      typeof pattern === "string"
        ? new RegExp(`^${pattern}$`, "i")
        : new RegExp(pattern.source, pattern.flags);
    return words.flatMap((word, index) => {
      matcher.lastIndex = 0;
      return matcher.test(word.text.replace(/[^\p{L}\p{N}'-]/gu, ""))
        ? [
            {
              ...word,
              index,
              before: words
                .slice(Math.max(0, index - context), index)
                .map((item) => item.text)
                .join(" "),
              after: words
                .slice(index + 1, index + 1 + context)
                .map((item) => item.text)
                .join(" "),
            },
          ]
        : [];
    });
  }
  async edit(
    label: string,
    commands: EditCommandInput[],
    options: EditOptions = {},
    signal?: AbortSignal,
  ): Promise<EditSummary> {
    if (!commands.length) return { label, skipped: "no commands" };
    const expectedRevision = options.expectedRevision ?? this.revision;
    if (expectedRevision == null)
      throw new ServiceError(
        "invalid",
        "Read status or project before editing, or supply expectedRevision.",
      );
    const batch = {
      label,
      commands,
      expectedRevision,
      ...(options.idempotencyKey == null ? {} : { idempotencyKey: options.idempotencyKey }),
    };
    const mode = options.dryRun ?? "first";
    if (mode) {
      const dry = readResult(
        ApplyResultSchema,
        await this.call("apply", { ...batch, dryRun: true }, signal),
        "apply",
      );
      if (mode === "only") return summarize(dry, commands.length);
    }
    return summarize(
      readResult(ApplyResultSchema, await this.call("apply", batch, signal), "apply"),
      commands.length,
    );
  }
  undo(expectedRevision = this.revision, count?: number, signal?: AbortSignal) {
    return this.call(
      "undo",
      {
        ...(expectedRevision == null ? {} : { expectedRevision }),
        ...(count == null ? {} : { count }),
      },
      signal,
    );
  }
}

export type EditOptions = {
  dryRun?: "first" | "only" | false;
  expectedRevision?: number;
  idempotencyKey?: string;
};
export type EditSummary =
  | { label: string; skipped: "no commands" }
  | {
      label: string;
      dryRun?: true;
      revision?: number;
      commands: number;
      added: number;
      changed: number;
      removed: number;
      createdIDs?: readonly string[];
      warnings?: readonly string[];
    };
function summarize(result: ApplyResult, commands: number): EditSummary {
  return {
    label: result.label,
    ...(result.dryRun ? { dryRun: true as const } : { revision: result.revision }),
    commands,
    added: result.added.length,
    changed: result.changed.length,
    removed: result.removed.length,
    ...(result.createdIDs.length && !result.dryRun
      ? { createdIDs: result.createdIDs.slice(0, 20) }
      : {}),
    ...(result.warnings.length ? { warnings: result.warnings } : {}),
  };
}
