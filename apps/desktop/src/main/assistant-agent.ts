import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import type { AssistantConnection, AssistantSettings } from "../shared/bridge.ts";

/** Model providers the user can configure the assistant with. */
export const assistantProviders = ["anthropic", "openai", "openrouter"] as const;
export type AssistantProvider = (typeof assistantProviders)[number];

const keyEnv: Record<AssistantProvider, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
};

type Credentials = { read(provider: string): Promise<string | undefined> };

export type AssistantAgentOptions = {
  /** Folder holding the built eve server (`server/index.mjs`). */
  outputDir: string;
  /** Where eve keeps durable session state, so conversations survive restarts. */
  dataDir: string;
  /** The desktop host's discovery file the agent's tools call through. */
  apiFile: string;
  /** The user's chosen provider and model. Not secret: keys stay in `credentials`. */
  settingsFile: string;
  credentials: Credentials;
  log?: (line: string) => void;
  /** Overridable for tests. */
  spawnServer?: (entry: string, env: NodeJS.ProcessEnv) => ChildProcess;
  healthTimeoutMs?: number;
};

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() =>
        address && typeof address === "object"
          ? resolve(address.port)
          : reject(new Error("No port.")),
      );
    });
  });

/**
 * Runs the eve assistant as a hidden child process, started the first time the panel asks for it.
 * It binds to 127.0.0.1 and accepts only a per-launch token that is handed to the app's own window.
 */
export class AssistantAgent {
  private running: Promise<AssistantConnection> | undefined;
  private child: ChildProcess | undefined;
  constructor(private readonly options: AssistantAgentOptions) {}

  /** The configured provider and model, and which providers have a saved key. */
  async settings(): Promise<AssistantSettings> {
    const saved: AssistantProvider[] = [];
    for (const provider of assistantProviders)
      if (await this.options.credentials.read(provider).catch(() => undefined))
        saved.push(provider);
    const chosen = await this.readChoice();
    return { provider: chosen?.provider ?? null, model: chosen?.model ?? null, keys: saved };
  }

  /** Save the user's provider and model, then restart so the next connect uses them. */
  async configure(value: unknown) {
    const choice = parseChoice(value);
    if (!choice) throw new Error("Choose a provider and enter a model ID.");
    await mkdir(dirname(this.options.settingsFile), { recursive: true });
    const temporary = `${this.options.settingsFile}.${randomBytes(6).toString("hex")}.tmp`;
    await writeFile(temporary, JSON.stringify(choice), { mode: 0o600 });
    await rename(temporary, this.options.settingsFile);
    await this.restart();
  }

  private async readChoice() {
    try {
      return parseChoice(JSON.parse(await readFile(this.options.settingsFile, "utf8")));
    } catch {
      return undefined;
    }
  }

  connect(): Promise<AssistantConnection> {
    this.running ??= this.start().then((connection) => {
      if (connection.status !== "ready") this.running = undefined;
      return connection;
    });
    return this.running;
  }

  /** Stop the agent so the next connect picks up changed keys. Sessions resume from disk. */
  async restart() {
    await this.close();
  }

  async close() {
    const child = this.child;
    this.running = undefined;
    this.child = undefined;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        resolve();
      }, 3000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      child.kill();
    });
  }

  private async start(): Promise<AssistantConnection> {
    // The user picks the provider and model; nothing is chosen for them.
    const choice = await this.readChoice();
    if (!choice) return { status: "needs-setup" };
    const { provider, model } = choice;
    const key = await this.options.credentials.read(provider).catch(() => undefined);
    if (!key) return { status: "needs-setup" };
    const entry = join(this.options.outputDir, "server", "index.mjs");
    try {
      await access(entry);
    } catch {
      return {
        status: "unavailable",
        message: "The assistant isn't built. Run `vp run --filter @sidecut/agent build`.",
      };
    }
    await mkdir(this.options.dataDir, { recursive: true });
    const port = await freePort(),
      token = randomBytes(32).toString("hex"),
      baseUrl = `http://127.0.0.1:${port}`;
    const childEnv: NodeJS.ProcessEnv = {
      ...pickInherited(process.env),
      // Only the chosen provider's key reaches the agent.
      [keyEnv[provider]]: key,
      ELECTRON_RUN_AS_NODE: "1",
      NODE_ENV: "production",
      HOST: "127.0.0.1",
      NITRO_HOST: "127.0.0.1",
      PORT: String(port),
      NITRO_PORT: String(port),
      SIDECUT_AGENT_TOKEN: token,
      SIDECUT_AGENT_PROVIDER: provider,
      SIDECUT_AGENT_MODEL: model,
      SIDECUT_API_FILE: this.options.apiFile,
      WORKFLOW_LOCAL_DATA_DIR: this.options.dataDir,
      WORKFLOW_LOCAL_BASE_URL: baseUrl,
      EVE_SCHEDULES_DISABLED: "1",
    };
    const spawnServer =
      this.options.spawnServer ??
      ((file, environment) =>
        spawn(process.execPath, [file], {
          cwd: this.options.outputDir,
          env: environment,
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        }));
    const child = spawnServer(entry, childEnv);
    this.child = child;
    const log = this.options.log ?? (() => {});
    child.stdout?.on("data", (chunk: Buffer) => log(chunk.toString()));
    child.stderr?.on("data", (chunk: Buffer) => log(chunk.toString()));
    child.once("exit", () => {
      if (this.child === child) {
        this.child = undefined;
        this.running = undefined;
      }
    });
    const deadline = Date.now() + (this.options.healthTimeoutMs ?? 30_000);
    while (Date.now() < deadline) {
      if (child.exitCode !== null || child.signalCode !== null)
        return { status: "unavailable", message: "The assistant stopped while starting." };
      try {
        const response = await fetch(`${baseUrl}/eve/v1/health`);
        if (response.ok) return { status: "ready", baseUrl, token, provider, model };
      } catch {
        // Not listening yet.
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    await this.close();
    return { status: "unavailable", message: "The assistant didn't start in time." };
  }
}

function parseChoice(value: unknown): { provider: AssistantProvider; model: string } | undefined {
  if (!value || typeof value !== "object") return undefined;
  const { provider, model } = value as Record<string, unknown>;
  if (!(assistantProviders as readonly unknown[]).includes(provider)) return undefined;
  if (typeof model !== "string") return undefined;
  const id = model.trim();
  // Provider model IDs: letters, digits and . _ - / : @ (e.g. anthropic/claude-sonnet-5.5).
  if (!id || id.length > 200 || !/^[\w./:@-]+$/.test(id)) return undefined;
  return { provider: provider as AssistantProvider, model: id };
}

/** Pass only what Node needs to run, never unrelated secrets from the app's environment. */
function pickInherited(env: NodeJS.ProcessEnv) {
  const keep = [
    "PATH",
    "Path",
    "SYSTEMROOT",
    "SystemRoot",
    "TEMP",
    "TMP",
    "TMPDIR",
    "HOME",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
    "XDG_CONFIG_HOME",
    "LANG",
  ];
  return Object.fromEntries(keep.flatMap((name) => (env[name] ? [[name, env[name]]] : [])));
}
