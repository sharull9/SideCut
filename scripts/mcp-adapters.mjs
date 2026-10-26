import { readFileSync } from "node:fs";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import { queryText } from "./cli-query-commands.mjs";
import { applyText } from "./cli-apply-command.mjs";
import { renderText } from "./cli-render-commands.mjs";
import { resourceText } from "./cli-resource-commands.mjs";
import { analysisText } from "./cli-analysis-commands.mjs";
import { libraryText } from "./cli-library-commands.mjs";
import { segmentText } from "./cli-foundation.mjs";

export const reference = JSON.parse(
  readFileSync(new URL("./mcp-tools.json", import.meta.url), "utf8"),
);
export const definitions = reference.tools.map((tool) => {
  const definition = structuredClone(tool);
  // These host guards remain explicit extensions to the pinned native contract.
  if (tool.name === "assets_generate")
    definition.inputSchema.properties.confirmedPaid = {
      type: "boolean",
      description: "Explicit opt-in before requesting paid generation.",
    };
  if (["assets_use", "segments_insert"].includes(tool.name))
    definition.inputSchema.properties.expectedRevision = {
      type: "integer",
      minimum: 0,
      description: "Reject insertion if the project revision changed.",
    };
  definition.description = `${tool.title} through the running SideCut desktop host. Returns readable text by default; json:true returns raw service data. Read warnings for adapter capability limits.`;
  return definition;
});
const validator = new AjvJsonSchemaValidator();
const validators = new Map(
  definitions.map((tool) => [tool.name, validator.getValidator(tool.inputSchema)]),
);

export function prepareTool(name, args = {}) {
  const tool = definitions.find((item) => item.name === name);
  if (!tool) throw new Error("Unknown tool.");
  const checked = validators.get(name)(args);
  if (!checked.valid) throw new Error(`Invalid ${name} arguments: ${checked.errorMessage}`);
  const { json = false, project, ...input } = { ...tool.defaults, ...args };
  return { tool, input, json, project };
}

export function clientAuthor(name = "mcp", env = process.env) {
  const explicit = env.SIDECUT_AUTHOR ?? env.TANDEM_AUTHOR;
  if (explicit) return explicit;
  const known = name.toLowerCase().match(/claude|codex|cursor|gemini/);
  return known?.[0] ?? name;
}

export function readableToolResult(operation, result) {
  if (operation === "apply") return applyText(result);
  if (operation.startsWith("assets-")) return libraryText(operation, result);
  if (["segments", "save-segment", "insert-segment"].includes(operation))
    return segmentText(operation, result);
  if (["frames", "screenshot", "clip", "export", "loudness"].includes(operation))
    return renderText(operation, result);
  if (["watch", "effects", "archive", "relink", "check"].includes(operation))
    return resourceText(operation, result);
  if (["comments", "sync", "wait", "transcribe", "diff", "restore", "clips"].includes(operation))
    return analysisText(operation, result);
  return queryText(operation, result);
}

export function toolResult(operation, result, json = false) {
  const { png, ...metadata } = result;
  const content =
    typeof png === "string" ? [{ type: "image", data: png, mimeType: "image/png" }] : [];
  content.push({
    type: "text",
    text: json ? JSON.stringify(metadata, null, 2) : readableToolResult(operation, metadata),
  });
  return { content, isError: false };
}
