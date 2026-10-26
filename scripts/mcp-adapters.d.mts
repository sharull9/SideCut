import type catalogue from "./mcp-tools.json";
export const reference: typeof catalogue;
export const definitions: typeof catalogue.tools;
export function prepareTool(
  name: string,
  args?: unknown,
): {
  tool: (typeof catalogue.tools)[number];
  input: Record<string, unknown>;
  json: boolean;
  project?: string;
};
export function clientAuthor(name?: string, env?: Record<string, string | undefined>): string;
export function readableToolResult(operation: string, result: unknown): string;
export function toolResult(
  operation: string,
  result: unknown,
  json?: boolean,
): {
  content: ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[];
  isError: false;
};
