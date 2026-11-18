import { describe, expect, it } from "vite-plus/test";
import { needsApproval } from "../agent/lib/approval.ts";
import { hostTools, modelSchema } from "../agent/lib/host.ts";
import { selectModel } from "../agent/lib/model.ts";

const tool = (name: string) => {
  const found = hostTools.find((item) => item.name === name);
  if (!found) throw new Error(`Missing host tool ${name}`);
  return found;
};
const asks = (name: string, input: Record<string, unknown> = {}) =>
  needsApproval(name, input, tool(name).annotations);

describe("assistant approvals", () => {
  it("lets reads run without asking", () => {
    for (const name of ["status", "timeline", "pauses", "history", "frame", "comments"])
      expect(asks(name)).toBe(false);
  });

  it("previews freely but asks before applying", () => {
    for (const name of ["tighten", "join", "captions", "short", "cards", "restore"]) {
      expect(asks(name)).toBe(false);
      expect(asks(name, { apply: true })).toBe(true);
    }
  });

  it("asks for dry-run tools unless the call is a dry run", () => {
    for (const name of ["sync", "archive", "relink"]) {
      expect(asks(name)).toBe(true);
      expect(asks(name, { dryRun: true })).toBe(false);
    }
  });

  it("asks before direct edits, undo, redo and export", () => {
    for (const name of ["apply", "undo", "redo", "export", "segments_insert"])
      expect(asks(name)).toBe(true);
  });

  it("always asks before paid generation or provider downloads", () => {
    expect(asks("assets_generate", { confirmedPaid: true })).toBe(true);
    expect(asks("assets_use")).toBe(true);
  });

  it("only lets studio status reads through", () => {
    expect(asks("studio", { action: "status" })).toBe(false);
    expect(asks("studio", { action: "recording-status" })).toBe(false);
    expect(asks("studio", { action: "switch" })).toBe(true);
    expect(asks("studio", { action: "recording-stop" })).toBe(true);
  });

  it("treats a tool it doesn't know as needing approval", () => {
    expect(needsApproval("something_new", {}, undefined)).toBe(true);
  });
});

describe("assistant tools", () => {
  it("exposes the same tools as the MCP server, without a project selector", () => {
    expect(hostTools.length).toBeGreaterThan(40);
    for (const item of hostTools) {
      expect(item.name).toMatch(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/);
      const schema = modelSchema(item.inputSchema) as { properties: Record<string, unknown> };
      expect(schema.properties).not.toHaveProperty("project");
    }
  });
});

describe("assistant model selection", () => {
  const key = { ANTHROPIC_API_KEY: "an", OPENAI_API_KEY: "oa", OPENROUTER_API_KEY: "or" };

  it("uses exactly the provider and model the user configured", () => {
    expect(
      selectModel({ ...key, SIDECUT_AGENT_PROVIDER: "openrouter", SIDECUT_AGENT_MODEL: "x/y" }),
    ).toEqual({ provider: "openrouter", model: "x/y" });
    expect(
      selectModel({ ...key, SIDECUT_AGENT_PROVIDER: "openai", SIDECUT_AGENT_MODEL: " gpt-x " }),
    ).toEqual({ provider: "openai", model: "gpt-x" });
  });

  it("never picks a provider or model on the user's behalf", () => {
    expect(selectModel(key)).toBeUndefined();
    expect(selectModel({ ...key, SIDECUT_AGENT_PROVIDER: "anthropic" })).toBeUndefined();
    expect(selectModel({ ...key, SIDECUT_AGENT_MODEL: "claude" })).toBeUndefined();
    expect(
      selectModel({ SIDECUT_AGENT_PROVIDER: "anthropic", SIDECUT_AGENT_MODEL: "claude" }),
    ).toBeUndefined();
    expect(
      selectModel({ ...key, SIDECUT_AGENT_PROVIDER: "other", SIDECUT_AGENT_MODEL: "m" }),
    ).toBeUndefined();
  });
});
