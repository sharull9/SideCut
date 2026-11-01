import { createServer } from "node:https";
import type { ServerOptions } from "node:https";
import type { RemoteControlAuthority } from "./remote-control.ts";

/** Opt-in TLS listener. The general-purpose HTTP service remains loopback-only. */
export class RemoteControlServer {
  private active = 0;
  private server;
  private port = 0;
  constructor(
    private readonly authority: RemoteControlAuthority,
    private readonly host: string,
    tls: Pick<ServerOptions, "key" | "cert">,
  ) {
    if (
      !/^(127\.0\.0\.1|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})$/.test(
        host,
      ) ||
      host.split(".").some((part) => Number(part) > 255)
    )
      throw new Error("Remote control must bind a private LAN or loopback IPv4 address.");
    if (!tls.key || !tls.cert) throw new Error("Remote control requires TLS credentials.");
    this.server = createServer(
      {
        ...tls,
        minVersion: "TLSv1.2",
        maxHeaderSize: 8192,
        requestTimeout: 10000,
        headersTimeout: 10000,
      },
      (request, response) => {
        const controller = new AbortController();
        response.once("close", () => controller.abort());
        const respond = (status: number, value: unknown) => {
          if (response.destroyed) return;
          response.writeHead(status, {
            "content-type": "application/json",
            "cache-control": "no-store",
            "x-content-type-options": "nosniff",
          });
          response.end(JSON.stringify(value));
        };
        if (request.method !== "POST" || !["/pair", "/intent"].includes(request.url ?? "")) {
          respond(404, { error: "Unavailable." });
          request.resume();
          return;
        }
        if (
          (request.headers.origin &&
            request.headers.origin !== `https://${this.host}:${this.port}`) ||
          !request.headers["content-type"]?.startsWith("application/json") ||
          request.headers["content-encoding"] ||
          this.active >= 16
        ) {
          respond(403, { error: "Request denied." });
          request.resume();
          return;
        }
        this.active++;
        void (async () => {
          try {
            const chunks: Buffer[] = [];
            let length = 0;
            for await (const chunk of request) {
              length += chunk.length;
              if (length > 8192) {
                respond(413, { error: "Request too large." });
                return;
              }
              chunks.push(chunk);
            }
            const input: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            if (!input || typeof input !== "object" || Array.isArray(input))
              throw new Error("Invalid request.");
            if (request.url === "/pair") {
              if (
                !("code" in input) ||
                !("name" in input) ||
                !("publicKey" in input) ||
                typeof input.code !== "string" ||
                typeof input.name !== "string" ||
                typeof input.publicKey !== "string" ||
                Object.keys(input).length !== 3
              )
                throw new Error("Invalid pairing.");
              respond(
                200,
                await authority.pair(
                  {
                    code: input.code,
                    name: input.name,
                    publicKey: input.publicKey,
                  },
                  controller.signal,
                ),
              );
            } else {
              if (
                !("intent" in input) ||
                !("signature" in input) ||
                Object.keys(input).length !== 2
              )
                throw new Error("Invalid intent.");
              respond(
                200,
                await authority.execute(input.intent, input.signature, controller.signal),
              );
            }
          } catch {
            respond(403, { error: "Remote request denied." });
          } finally {
            this.active--;
          }
        })();
      },
    );
    this.server.maxConnections = 16;
  }
  async start() {
    await new Promise<void>((resolve, reject) => {
      const failed = (error: Error) => reject(error);
      this.server.once("error", failed);
      this.server.listen(0, this.host, () => {
        this.server.removeListener("error", failed);
        resolve();
      });
    });
    const address = this.server.address();
    if (!address || typeof address === "string") throw new Error("Remote listener unavailable.");
    this.port = address.port;
    return { host: this.host, port: this.port };
  }
  async close() {
    this.authority.close();
    this.server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      this.server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}
