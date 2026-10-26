import { it, expect } from "vite-plus/test";
import { editCommandJsonSchema } from "@sidecut/contracts/commands";
import { transitionTypes } from "@sidecut/contracts/project";
import { serviceDefinitions } from "@sidecut/core/service-requests";
import { queryDefinitions } from "@sidecut/core/project-queries";
import { effectRegistry, renderedEffects } from "@sidecut/core/effects";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import inventory from "../../../../tests/fixtures/tandem/pinned-inventory.json";
import { definitions as mcpTools } from "../../../../scripts/mcp-adapters.mjs";
it("accounts for every pinned edit command, service, asset operation and MCP tool", async () => {
  const commandSchema = editCommandJsonSchema();
  const names = new Set<string>();
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (value && typeof value === "object") {
      if ("properties" in value && value.properties && typeof value.properties === "object")
        for (const name of Object.keys(value.properties))
          if (inventory.commands.includes(name)) names.add(name);
      Object.values(value).forEach(visit);
    }
  };
  visit(commandSchema);
  expect([...names].sort()).toEqual([...inventory.commands].sort());
  const operations = { ...serviceDefinitions, ...queryDefinitions };
  const projectMissing = inventory.service.filter((name) => !Object.hasOwn(operations, name));
  expect(projectMissing).toEqual([]);
  const assetMissing = inventory.assets.filter(
    (operation) =>
      !Object.hasOwn(
        operations,
        ["segments", "save-segment", "insert-segment"].includes(operation)
          ? operation
          : `assets-${operation}`,
      ),
  );
  expect(assetMissing).toEqual([]);
  expect(mcpTools.map((tool) => tool.name).sort()).toEqual([...inventory.tools].sort());
  expect(effectRegistry.map((e) => e.type).sort()).toEqual([...inventory.effects].sort());
  expect([...transitionTypes].sort()).toEqual([...inventory.transitions].sort());
  if (process.env.SIDECUT_WRITE_PARITY_AUDIT === "1")
    await writeFile(
      resolve("docs/verification/phase-140-inventory.json"),
      JSON.stringify(
        {
          revision: inventory.revision,
          verdict: "partial compatibility; inventory coverage is not full parity",
          commands: { expected: inventory.commands, present: [...names].sort(), missing: [] },
          projectService: { expected: inventory.service, missing: projectMissing },
          assets: { expected: inventory.assets, missing: assetMissing },
          mcp: {
            expected: inventory.tools,
            note: "All names discovered over actual stdio in phases 131–135; exact result/default compatibility remains partial.",
          },
          effects: effectRegistry.map((e) => ({
            type: e.type,
            rendered: renderedEffects.has(e.type),
          })),
          transitions: transitionTypes,
          externalAcceptance: [
            "Tandem macOS round trip",
            "native macOS installation/signing/permissions",
            "native Linux package installation/keyring/session",
            "public hosted browser deployment",
            "reference render/audio golden comparisons",
          ],
        },
        null,
        2,
      ) + "\n",
    );
});
