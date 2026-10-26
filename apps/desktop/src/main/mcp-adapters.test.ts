import { expect, it } from "vite-plus/test";
import { createHash } from "node:crypto";
import {
  reference,
  definitions,
  prepareTool,
  clientAuthor,
  toolResult,
} from "../../../../scripts/mcp-adapters.mjs";
import contract from "../../../../tests/fixtures/tandem/mcp-reference.json";
import inventory from "../../../../tests/fixtures/tandem/pinned-inventory.json";
import queries from "../../../../tests/fixtures/tandem/cli-queries.json";
import helpers from "../../../../tests/fixtures/tandem/cli-helpers.json";
import cards from "../../../../tests/fixtures/tandem/cli-cards.json";
import apply from "../../../../tests/fixtures/tandem/cli-apply.json";
import review from "../../../../tests/fixtures/tandem/cli-history-review.json";
import render from "../../../../tests/fixtures/tandem/cli-render.json";
import resources from "../../../../tests/fixtures/tandem/cli-resources.json";
import analysis from "../../../../tests/fixtures/tandem/cli-analysis.json";
import library from "../../../../tests/fixtures/tandem/cli-library.json";

it("pins all 43 native tool contracts and documents the portable apply schema", () => {
  expect(reference.revision).toBe(contract.revision);
  expect(createHash("sha256").update(JSON.stringify(reference)).digest("hex")).toBe(
    contract.sha256,
  );
  expect(definitions.map((tool) => tool.name).sort()).toEqual([...inventory.tools].sort());
  expect(reference.notice).toContain("portable SideCut");
  for (const tool of reference.tools) {
    const captured = contract.tools.find((item) => item.name === tool.name)!;
    expect(Object.keys(tool.inputSchema.properties)).toEqual(captured.properties);
    expect(tool.inputSchema.required ?? []).toEqual(captured.required);
    expect(tool.annotations).toEqual(captured.annotations);
  }
});

it("validates metadata and native argument types before dispatch, without mutating inputs", () => {
  expect(
    prepareTool("frame", { time: "0:01", json: true, project: "sample.tandem" }),
  ).toMatchObject({
    input: { time: "0:01", maxWidth: 1280 },
    json: true,
    project: "sample.tandem",
  });
  const args = { time: 0, maxWidth: 320 };
  expect(prepareTool("frame", args).input).toEqual(args);
  expect(args).toEqual({ time: 0, maxWidth: 320 });
  for (const [name, invalid] of [
    ["status", { json: "true" }],
    ["status", { project: 3 }],
    ["status", { unknown: true }],
    ["frame", {}],
    ["assets_generate", { kind: "invalid", prompt: "test" }],
    ["segments_save", { name: "test", fields: [{ clipID: "a", unknown: true }] }],
    ["apply", { commands: [{ notACommand: {} }] }],
  ] as const)
    expect(() => prepareTool(name, invalid)).toThrow();
  expect(() => prepareTool("missing")).toThrow("Unknown tool");
  expect(
    prepareTool("assets_generate", { kind: "sfx", prompt: "test", confirmedPaid: false }).input,
  ).toMatchObject({ confirmedPaid: false });
  expect(clientAuthor("Claude Desktop", {})).toBe("claude");
  expect(clientAuthor("Acceptance", {})).toBe("Acceptance");
  expect(clientAuthor("Codex", { SIDECUT_AUTHOR: "owner", TANDEM_AUTHOR: "old" })).toBe("owner");
});

it("reuses the pinned readable formatters and returns image blocks before metadata", () => {
  const cases = [
    {
      examples: [
        { operation: "transcript", ...queries.transcript },
        { operation: "search", ...queries.search },
      ],
    },
    helpers,
    { examples: cards.examples.map((sample) => ({ operation: "cards", ...sample })) },
    { examples: apply.examples.map((sample) => ({ operation: "apply", ...sample })) },
    review,
    render,
    resources,
    analysis,
    library,
  ];
  for (const fixture of cases)
    for (const sample of fixture.examples) {
      const result = toolResult(sample.operation, sample.result);
      expect(result.isError).toBe(false);
      expect(result.content.at(-1)).toEqual({ type: "text", text: sample.text });
      const raw = toolResult(sample.operation, sample.result, true);
      const text = raw.content.at(-1);
      expect(text?.type).toBe("text");
      if (text?.type === "text") {
        const { png: _png, ...metadata } = sample.result as Record<string, unknown>;
        expect(JSON.parse(text.text)).toEqual(metadata);
      }
    }
  expect(toolResult("frame", { png: "fixture", time: 0, width: 16, height: 9 }, true)).toEqual({
    isError: false,
    content: [
      { type: "image", data: "fixture", mimeType: "image/png" },
      { type: "text", text: JSON.stringify({ time: 0, width: 16, height: 9 }, null, 2) },
    ],
  });
});
