import type { serviceDefinitions, requiredServiceFields } from "@sidecut/core/service-requests";
import type { EditCommand } from "@sidecut/contracts/commands";
import type { queryDefinitions } from "@sidecut/core/project-queries";
export type { EditCommand, EditBatch } from "@sidecut/contracts/commands";

type Value<T> = T extends "boolean"
  ? boolean
  : T extends "number" | "integer"
    ? number
    : T extends "time" | "reference"
      ? number | string
      : T extends "times"
        ? (number | string)[]
        : T extends "strings"
          ? string[]
          : T extends "array"
            ? EditCommand[]
            : string;
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
  private readonly endpoint: { port: number; token: string };
  private readonly transport: typeof fetch;
  constructor(endpoint: { port: number; token: string }, transport: typeof fetch = fetch) {
    if (
      !Number.isInteger(endpoint.port) ||
      endpoint.port < 1 ||
      endpoint.port > 65535 ||
      !/^[a-f0-9]{64}$/.test(endpoint.token)
    )
      throw new Error("Invalid host endpoint.");
    this.endpoint = endpoint;
    this.transport = transport;
  }
  async call<K extends ServiceOperation>(
    operation: K,
    input: ServiceRequest<K>,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const response = await this.transport(
      `http://127.0.0.1:${this.endpoint.port}/v1/${operation}`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.endpoint.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(input),
        ...(signal ? { signal } : {}),
      },
    );
    const result: unknown = await response.json();
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
    return result;
  }
  /** Repeating this exact request is safe: retain the idempotency key and expected revision. */
  apply(
    commands: EditCommand[],
    options: { expectedRevision: number; idempotencyKey: string; label?: string },
    signal?: AbortSignal,
  ) {
    return this.call("apply", { commands, ...options }, signal);
  }
}
