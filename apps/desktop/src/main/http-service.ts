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
  private unsubscribe: () => void;
  private leases = new Map<string, number>();
  private leaseTimer: ReturnType<typeof setInterval> | undefined;
  get leaseCount() {
    return this.leases.size;
  }
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
  constructor(
    private readonly api: ProjectAPI,
    private readonly options: {
      headless?: boolean;
      onIdle?: () => void;
      onOwnerRelease?: () => void;
      busy?: () => boolean;
    } = {},
  ) {
    let last = 0;
    this.unsubscribe = api.project.subscribe(() => {
      for (const { seq, kind, date: _date, ...event } of api.project.recentEvents()) {
        if (seq <= last) continue;
        last = seq;
        if (kind === "edit" || kind === "undo" || kind === "redo" || kind === "reload")
          api.events.publish({ ...event, kind });
      }
    });
    this.server.maxConnections = 16;
    if (options.headless)
      this.leaseTimer = setInterval(() => {
        for (const [id, deadline] of this.leases) if (deadline < Date.now()) this.leases.delete(id);
        if (!this.leases.size) options.onIdle?.();
      }, 10000);
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
    return {
      port: this.port,
      token: this.token,
      pid: process.pid,
      apiVersion: "0.1.0",
      ...(this.options.headless ? { headless: true } : {}),
    };
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
      if (this.options.headless && ["host-lease", "host-release"].includes(match[1]!)) {
        if (match[1] === "host-lease") {
          if (!this.api.ready()) {
            fail(503, "unavailable", "Renderer is starting.");
            return;
          }
          const id =
            "lease" in input && typeof input.lease === "string"
              ? input.lease
              : randomBytes(32).toString("hex");
          if (!/^[a-f0-9]{64}$/.test(id) || ("lease" in input && !this.leases.has(id))) {
            fail(400, "badRequest", "Unknown host lease.");
            return;
          }
          if (this.leases.size >= 64 && !this.leases.has(id)) {
            fail(503, "unavailable", "Too many host leases.");
            return;
          }
          this.leases.set(id, Date.now() + 45000);
          send(200, { lease: id });
        } else {
          if (
            !("lease" in input) ||
            typeof input.lease !== "string" ||
            !this.leases.delete(input.lease)
          ) {
            fail(400, "badRequest", "Unknown host lease.");
            return;
          }
          send(200, {
            released: true,
            leases: this.leases.size,
            busy: this.options.busy?.() ?? false,
          });
          if ("ownerReleased" in input && input.ownerReleased === true)
            this.options.onOwnerRelease?.();
          if (!this.leases.size) setImmediate(() => this.options.onIdle?.());
        }
        return;
      }
      if (match[1] === "watch" && request.headers.accept?.includes("text/event-stream")) {
        const raw = request.headers["last-event-id"];
        const after = raw === undefined ? undefined : Number(raw);
        if (after !== undefined && (!Number.isSafeInteger(after) || after < 0)) {
          fail(400, "badRequest", "Last-Event-ID must be a nonnegative event sequence.");
          return;
        }
        response.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "X-Content-Type-Options": "nosniff",
          Connection: "close",
        });
        response.write(
          `retry: 2000\nevent: hello\ndata: ${JSON.stringify({
            revision: JSON.parse(this.api.project.snapshot().json).revision,
            seq: this.api.events.lastSeq,
          })}\n\n`,
        );
        const stop = this.api.events.subscribe(after, (event) => {
          if (response.destroyed) return;
          if (response.writableLength > 1024 * 1024) {
            response.destroy();
            return;
          }
          response.write(
            `id: ${event.seq}\nevent: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`,
          );
        });
        const keepAlive = setInterval(() => {
          if (response.writableLength > 1024 * 1024) response.destroy();
          else response.write(": keep-alive\n\n");
        }, 15000);
        try {
          await new Promise<void>((resolve) => {
            const finish = () => {
              controller.signal.removeEventListener("abort", finish);
              resolve();
            };
            controller.signal.addEventListener("abort", finish, { once: true });
            if (controller.signal.aborted) finish();
          });
        } finally {
          clearInterval(keepAlive);
          stop();
          response.end();
        }
        return;
      }
      const legacyRelink = match[1] === "relink" && ("mediaID" in input || "path" in input);
      if (serviceFields[match[1]!]?.author && !legacyRelink)
        input = {
          author:
            typeof request.headers["x-tandem-author"] === "string"
              ? request.headers["x-tandem-author"]
              : "agent",
          ...input,
        };
      const result = await this.api.handle(match[1]!, input, controller.signal);
      if (this.api.project.snapshot().saveState === "saving") await this.api.project.flush();
      send(200, result);
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
    this.unsubscribe();
    clearInterval(this.leaseTimer);
    this.leases.clear();
    for (const controller of this.controllers) controller.abort();
    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => (error ? reject(error) : resolve()));
      this.server.closeAllConnections();
    });
    await Promise.allSettled(this.pending);
  }
}
