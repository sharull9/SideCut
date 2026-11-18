import { describe, expect, it, vi } from "vite-plus/test";
import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChildProcess } from "node:child_process";
import { AssistantAgent } from "./assistant-agent.ts";

const credentials = (saved: Record<string, string>) => ({
  read: async (provider: string) => saved[provider],
});

async function builtOutput() {
  const folder = await mkdtemp(join(tmpdir(), "sidecut-assistant-agent-"));
  await mkdir(join(folder, "server"));
  await writeFile(join(folder, "server", "index.mjs"), "");
  return folder;
}

const options = (outputDir: string, saved: Record<string, string>) => ({
  outputDir,
  dataDir: join(outputDir, "data"),
  apiFile: join(outputDir, "api.json"),
  settingsFile: join(outputDir, "assistant-settings.json"),
  credentials: credentials(saved),
});

describe("assistant agent process", () => {
  it("waits for the user to set it up, even when a key is saved", async () => {
    const spawnServer = vi.fn();
    const agent = new AssistantAgent({
      ...options(await builtOutput(), { anthropic: "an", openai: "oa" }),
      spawnServer,
    });
    expect(await agent.connect()).toEqual({ status: "needs-setup" });
    expect(spawnServer).not.toHaveBeenCalled();
  });

  it("needs the chosen provider's key, not just any key", async () => {
    const spawnServer = vi.fn();
    const agent = new AssistantAgent({
      ...options(await builtOutput(), { anthropic: "an" }),
      spawnServer,
    });
    await agent.configure({ provider: "openai", model: "gpt-x" });
    expect(await agent.connect()).toEqual({ status: "needs-setup" });
    expect(spawnServer).not.toHaveBeenCalled();
  });

  it("saves and reports the user's choice", async () => {
    const agent = new AssistantAgent(
      options(await builtOutput(), { openrouter: "or", anthropic: "an" }),
    );
    expect(await agent.settings()).toEqual({
      provider: null,
      model: null,
      keys: ["anthropic", "openrouter"],
    });
    await agent.configure({ provider: "openrouter", model: " vendor/model-1 " });
    expect(await agent.settings()).toMatchObject({
      provider: "openrouter",
      model: "vendor/model-1",
    });
  });

  it("rejects an unknown provider or a malformed model ID", async () => {
    const agent = new AssistantAgent(options(await builtOutput(), {}));
    await expect(agent.configure({ provider: "other", model: "m" })).rejects.toThrow();
    await expect(agent.configure({ provider: "openai", model: "" })).rejects.toThrow();
    await expect(agent.configure({ provider: "openai", model: "a b" })).rejects.toThrow();
  });

  it("reports a missing build instead of failing silently", async () => {
    const folder = await mkdtemp(join(tmpdir(), "sidecut-assistant-agent-"));
    const agent = new AssistantAgent(options(folder, { openai: "sk-test" }));
    await agent.configure({ provider: "openai", model: "gpt-x" });
    const connection = await agent.connect();
    expect(connection.status).toBe("unavailable");
  });

  it("starts on loopback with a fresh token and only the chosen key and model", async () => {
    let env: NodeJS.ProcessEnv = {};
    const health = createServer((_request, response) => response.end("{}"));
    const spawnServer = vi.fn((_entry: string, environment: NodeJS.ProcessEnv) => {
      env = environment;
      // Stand in for the eve server by serving the health route on the chosen port.
      health.listen(Number(environment.PORT), "127.0.0.1");
      const child = new EventEmitter() as ChildProcess;
      Object.assign(child, { exitCode: null, signalCode: null, kill: () => true });
      return child;
    });
    process.env.SIDECUT_UNRELATED_SECRET = "do-not-pass";
    const agent = new AssistantAgent({
      ...options(await builtOutput(), { openai: "sk-test", openrouter: "or-test" }),
      spawnServer,
    });
    try {
      await agent.configure({ provider: "openai", model: "gpt-x" });
      const connection = await agent.connect();
      expect(connection).toMatchObject({ status: "ready", provider: "openai", model: "gpt-x" });
      if (connection.status !== "ready") throw new Error("not ready");
      expect(connection.baseUrl).toBe(`http://127.0.0.1:${env.PORT}`);
      expect(connection.token).toMatch(/^[a-f0-9]{64}$/);
      expect(env).toMatchObject({
        HOST: "127.0.0.1",
        SIDECUT_AGENT_TOKEN: connection.token,
        SIDECUT_AGENT_PROVIDER: "openai",
        SIDECUT_AGENT_MODEL: "gpt-x",
        OPENAI_API_KEY: "sk-test",
        ELECTRON_RUN_AS_NODE: "1",
      });
      expect(env.OPENROUTER_API_KEY).toBeUndefined();
      expect(env.SIDECUT_UNRELATED_SECRET).toBeUndefined();
      expect(env.ANTHROPIC_API_KEY).toBeUndefined();
      // A second connect reuses the running agent.
      expect(await agent.connect()).toBe(connection);
      expect(spawnServer).toHaveBeenCalledTimes(1);
    } finally {
      delete process.env.SIDECUT_UNRELATED_SECRET;
      await agent.close();
      health.close();
    }
  });
});
