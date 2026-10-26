// Extract the pinned Swift tool metadata without requiring a macOS Swift runtime.
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
const revision = "735a9b8e162c1f951044baa892d94993869f2e77",
  reference = resolve(process.argv[2] ?? join(homedir(), ".cache/sidecut-tandem-reference"));
assert.equal(
  execFileSync("git", ["-C", reference, "rev-parse", "HEAD"], {
    encoding: "utf8",
    windowsHide: true,
  }).trim(),
  revision,
);
const source = await readFile(join(reference, "Sources/TandemAPI/MCPServer.swift"), "utf8"),
  batch = JSON.parse(await readFile(new URL("./edit-batch.schema.json", import.meta.url), "utf8"));
function split(text, delimiter = ",") {
  const result = [];
  let start = 0,
    depth = 0,
    string = false,
    escape = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (string) {
      if (escape) escape = false;
      else if (c === "\\") escape = true;
      else if (c === '"') string = false;
      continue;
    }
    if (c === '"') string = true;
    else if ("([{ ".trim().includes(c)) depth++;
    else if (")] }".replaceAll(" ", "").includes(c)) depth--;
    else if (c === delimiter && depth === 0) {
      result.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  assert.equal(depth, 0, "Unbalanced Swift expression");
  assert.equal(string, false, "Unclosed Swift string");
  const tail = text.slice(start).trim();
  if (tail) result.push(tail);
  return result;
}
function dictionary(text) {
  if (text.trim() === "[:]") return {};
  assert.ok(text.startsWith("[") && text.endsWith("]"), text);
  return Object.fromEntries(
    split(text.slice(1, -1)).map((pair) => {
      const parts = split(pair, ":");
      assert.equal(parts.length, 2, pair);
      return [JSON.parse(parts[0]), value(parts[1])];
    }),
  );
}
function value(text) {
  text = text.trim();
  if (text === "WaitTarget.allCases.map(\\.rawValue)")
    return ["transcript", "matte", "proxy", "jobs", "export"];
  if (text === "StickerAnchor.allCases.map(\\.rawValue)")
    return [
      "bottom",
      "bottomLeft",
      "bottomRight",
      "top",
      "topLeft",
      "topRight",
      "centre",
      "lowerThird",
    ];
  if (text === "applyProperties")
    return {
      ...batch.properties,
      dryRun: {
        type: "boolean",
        description: "Check the batch on a copy without changing anything.",
      },
    };
  if (text.startsWith('"')) return JSON.parse(text);
  if (text === "true" || text === "false") return text === "true";
  if (text.startsWith("[")) {
    if (split(text.slice(1, -1), ":").length > 1) return dictionary(text);
    return split(text.slice(1, -1)).map(value);
  }
  if (text === "nil") return null;
  if (/^[-\d.]+$/.test(text)) return Number(text);
  const call = /^([\w.]+)\(([\s\S]*)\)$/.exec(text);
  assert.ok(call, `Unknown expression: ${text}`);
  const args = split(call[2]),
    name = call[1];
  if ([".number", ".string", ".bool"].includes(name)) return value(args[0]);
  if (name === "time")
    return { type: ["number", "string"], description: value(args[0]) + " Seconds or mm:ss.mmm." };
  if (name === "S.object") {
    const required = args.find((a) => a.startsWith("required:"));
    const r = { type: "object", properties: dictionary(args[0]), additionalProperties: false };
    if (required) {
      const list = value(required.slice(9).trim());
      if (list.length) r.required = list;
    }
    return r;
  }
  const withDescription = (schema, index = 0) =>
    args[index] ? { ...schema, description: value(args[index]) } : schema;
  if (name === "S.array") return withDescription({ type: "array", items: value(args[0]) }, 1);
  if (name === "S.map")
    return withDescription({ type: "object", additionalProperties: value(args[0]) }, 1);
  if (name === "S.ids") return withDescription({ type: "array", items: { type: "string" } });
  if (name === "S.enumeration") return withDescription({ type: "string", enum: value(args[0]) }, 1);
  assert.ok(
    ["S.string", "S.number", "S.integer", "S.boolean"].includes(name),
    `Unknown schema helper: ${name}`,
  );
  return withDescription({ type: name.slice(2) });
}
const all = source.slice(
  source.indexOf("static let all: [Tool] = [") + "static let all: [Tool] = [".length,
  source.indexOf("\n    ]\n}", source.indexOf("static let all: [Tool] = [")),
);
const tools = split(all).map((text) => {
  assert.ok(text.startsWith("Tool(") && text.endsWith(")"), text.slice(0, 100));
  const fields = Object.fromEntries(
    split(text.slice(5, -1)).map((pair) => {
      const parts = split(pair, ":");
      assert.equal(parts.length, 2, pair);
      return parts;
    }),
  );
  const name = value(fields.name),
    asset = fields.asset?.slice(1),
    operation =
      fields.operation?.slice(1) ??
      { saveSegment: "save-segment", insertSegment: "insert-segment", segments: "segments" }[
        asset
      ] ??
      `assets-${asset}`,
    usesProject = !asset || ["use", "credits", "saveSegment", "insertSegment"].includes(asset),
    properties =
      fields.properties === "applyProperties"
        ? value(fields.properties)
        : dictionary(fields.properties);
  if (usesProject)
    properties.project = {
      type: "string",
      description: "Path to the .tandem file (or its folder). Defaults to the configured project.",
    };
  properties.json = {
    type: "boolean",
    description: "Return the raw JSON result instead of readable text.",
  };
  const inputSchema = { type: "object", properties, additionalProperties: false };
  if (fields.required) inputSchema.required = value(fields.required);
  if (name === "apply") inputSchema.$defs = batch.$defs;
  return {
    name,
    title: value(fields.title),
    description: value(fields.description),
    operation,
    usesProject,
    inputSchema,
    annotations: {
      title: value(fields.title),
      readOnlyHint: value(fields.readOnly),
      destructiveHint: false,
      idempotentHint: fields.idempotent ? value(fields.idempotent) : false,
      openWorldHint: fields.openWorld ? value(fields.openWorld) : false,
    },
    defaults: fields.defaults ? dictionary(fields.defaults) : {},
  };
});
assert.equal(tools.length, 43);
assert.equal(new Set(tools.map((t) => t.name)).size, 43);
const catalogue = {
  revision,
  notice:
    "Tool properties/defaults/annotations extracted from pinned Swift. Apply command properties/definitions use the current portable SideCut command schema, not native model definitions. Project field help shortened. TANDEM-LICENSE applies.",
  tools,
};
await writeFile(
  new URL("./mcp-tools.json", import.meta.url),
  JSON.stringify(catalogue, null, 2) + "\n",
);
await writeFile(
  new URL("../tests/fixtures/tandem/mcp-reference.json", import.meta.url),
  JSON.stringify(
    {
      revision,
      sources: ["Sources/TandemAPI/MCPServer.swift", "Sources/TandemAPI/CommandSchema.swift"],
      sha256: createHash("sha256").update(JSON.stringify(catalogue)).digest("hex"),
      notice: catalogue.notice,
      tools: tools.map((t) => ({
        name: t.name,
        operation: t.operation,
        properties: Object.keys(t.inputSchema.properties),
        required: t.inputSchema.required ?? [],
        defaults: t.defaults,
        annotations: t.annotations,
      })),
    },
    null,
    2,
  ) + "\n",
);
console.log(`Captured ${tools.length} pinned MCP tools.`);
