// The same adapters back the MCP server and the CLI, so all three expose one tool list.
import { definitions, prepareTool, toolResult } from "../../../../scripts/mcp-adapters.mjs";
import { discoverHost, hostCall } from "../../../../scripts/host-client.mjs";
import effectsCatalog from "../../../../scripts/effects-catalog.json" with { type: "json" };
import type { ToolAnnotations } from "./approval.ts";

export type HostToolDefinition = {
  name: string;
  title: string;
  description: string;
  operation: string;
  usesProject: boolean;
  inputSchema: Record<string, unknown>;
  annotations?: ToolAnnotations;
};

export type ToolContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

export const hostTools = definitions as HostToolDefinition[];

/** The assistant always edits the project open in this desktop window, so hide `project`. */
export function modelSchema(schema: Record<string, unknown>): JsonObject {
  const properties = { ...(schema.properties as Record<string, unknown> | undefined) };
  delete properties.project;
  return { ...schema, properties } as JsonObject;
}
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };

export async function callHostTool(
  name: string,
  args: Record<string, unknown>,
  signal: AbortSignal,
): Promise<ToolContent[]> {
  const { tool, input, json } = prepareTool(name, args) as {
    tool: HostToolDefinition;
    input: Record<string, unknown>;
    json: boolean;
  };
  if (tool.name === "effects") {
    const result = structuredClone(effectsCatalog) as { effects: { type: string }[] };
    if (typeof input.type === "string") {
      const type = input.type.toLowerCase();
      result.effects = result.effects.filter((effect) => effect.type.toLowerCase() === type);
    }
    if (!result.effects.length) throw new Error("Unknown effect type.");
    return toolResult(tool.operation, result, json).content as ToolContent[];
  }
  const host = await discoverHost(process.env.SIDECUT_API_FILE);
  const result = await hostCall(host, tool.operation, input, signal, "assistant");
  return toolResult(tool.operation, result, json).content as ToolContent[];
}
