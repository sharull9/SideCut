import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { QueryError } from "@sidecut/core/project-queries";
import { EditError } from "@sidecut/core/coordinator";
import type { ProjectAPI } from "./project-api.ts";
import { serviceFields } from "@sidecut/core/service-requests";

export class LocalHTTPService {
  readonly token = randomBytes(32).toString("hex");
  private port = 0;
  private active = 0;
  private controllers = new Set<AbortController>();
  private pending = new Set<Promise<void>>();
  private server = createServer(
    { maxHeaderSize: 8192, requestTimeout: 10000, headersTimeout: 10000 },
    (request, response) => {
      const task = this.respond(request, response);
      this.pending.add(task);
      void task.then(
        () => this.pending.delete(task),
        () => this.pending.delete(task),
      );
    },
  );
  constructor(private readonly api: ProjectAPI) {
    this.server.maxConnections = 16;
    this.server.timeout = 86430000;
    this.server.on("clientError", (_error, socket) =>
      socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n"),
    );
  }
  async start() {
    await new Promise<void>((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(0, "127.0.0.1", () => {
        this.server.removeListener("error", reject);
        resolve();
      });
    });
    const address = this.server.address();
    if (!address || typeof address === "string")
      throw new Error("Loopback listener did not start.");
    this.port = address.port;
    return { port: this.port, token: this.token, pid: process.pid, apiVersion: "0.1.0" };
  }
  private async respond(request: IncomingMessage, response: ServerResponse) {
    const send = (status: number, value: unknown) => {
      if (response.destroyed) return;
      response.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        Connection: "close",
      });
      response.end(JSON.stringify(value));
    };
    const fail = (status: number, code: string, message: string, revision?: number) =>
      send(status, { error: { code, message, ...(revision === undefined ? {} : { revision }) } });
    if (
      request.headers.host !== `127.0.0.1:${this.port}` ||
      request.headers.origin !== undefined ||
      request.headers["sec-fetch-site"] === "cross-site"
    ) {
      fail(403, "unauthorized", "Untrusted host or browser origin.");
      request.resume();
      return;
    }
    if (request.url === "/v1/health" && request.method === "GET") {
      send(200, { ok: true, service: "tandem", apiVersion: "0.1.0" });
      return;
    }
    const authorization = Buffer.from(request.headers.authorization ?? ""),
      expected = Buffer.from(`Bearer ${this.token}`);
    if (authorization.length !== expected.length || !timingSafeEqual(authorization, expected)) {
      fail(401, "unauthorized", "Missing or wrong API token.");
      request.resume();
      return;
    }
    if (!["GET", "POST"].includes(request.method ?? "")) {
      fail(405, "badRequest", "Use GET or POST.");
      request.resume();
      return;
    }
    if (this.active >= 8) {
      fail(503, "unavailable", "Too many requests.");
      request.resume();
      return;
    }
    const match = /^\/v1\/([a-z]+(?:-[a-z]+)*)$/.exec(request.url ?? "");
    if (!match) {
      fail(404, "notFound", "Unknown endpoint.");
      request.resume();
      return;
    }
    if (
      request.method === "POST" &&
      request.headers["content-type"]?.split(";")[0]?.trim() !== "application/json"
    ) {
      fail(400, "badRequest", "POST requires application/json.");
      request.resume();
      return;
    }
    this.active++;
    const controller = new AbortController();
    this.controllers.add(controller);
    const cancel = () => {
      if (!response.writableEnded) controller.abort();
    };
    response.once("close", cancel);
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of request) {
        const bytes = Buffer.from(chunk);
        size += bytes.length;
        if (size > 2 * 1024 * 1024) {
          fail(413, "badRequest", "Request exceeds 2 MiB.");
          return;
        }
        chunks.push(bytes);
      }
      if (request.method === "GET" && size > 0) {
        fail(400, "badRequest", "GET must not have a body.");
        return;
      }
      const body = Buffer.concat(chunks).toString("utf8");
      let input: unknown = {};
      try {
        input = body ? JSON.parse(body) : {};
      } catch {
        fail(400, "badRequest", "Invalid JSON request.");
        return;
      }
      if (!input || typeof input !== "object" || Array.isArray(input)) {
        fail(400, "badRequest", "Request must be an object.");
        return;
      }
      if (serviceFields[match[1]!]?.author)
        input = {
          author:
            typeof request.headers["x-tandem-author"] === "string"
              ? request.headers["x-tandem-author"]
              : "agent",
          ...input,
        };
      send(200, await this.api.handle(match[1]!, input, controller.signal));
    } catch (error) {
      if (error instanceof QueryError)
        fail(
          error.code === "notFound"
            ? 404
            : error.code === "unavailable"
              ? 503
              : error.code === "nothingToUndo" || error.code === "nothingToRedo"
                ? 409
                : error.code === "notImplemented"
                  ? 501
                  : 400,
          error.code,
          error.message,
          error.revision,
        );
      else if (error instanceof EditError)
        fail(
          error.code === "stale-revision" ? 409 : 400,
          error.code === "stale-revision" ? "staleRevision" : "invalid",
          error.message,
          error.code === "stale-revision"
            ? JSON.parse(this.api.project.snapshot().json).revision
            : undefined,
        );
      else fail(400, "badRequest", error instanceof Error ? error.message : String(error));
    } finally {
      this.active--;
      this.controllers.delete(controller);
      response.removeListener("close", cancel);
    }
  }
  async close() {
    for (const controller of this.controllers) controller.abort();
    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => (error ? reject(error) : resolve()));
      this.server.closeAllConnections();
    });
    await Promise.allSettled(this.pending);
  }
}
