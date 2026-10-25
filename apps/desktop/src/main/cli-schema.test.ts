import { expect, it } from "vite-plus/test";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { editBatchJsonSchema } from "@sidecut/contracts/commands";

it("ships the authoritative edit batch schema for offline CLI use", async () => {
  const schema = editBatchJsonSchema();
  expect(schema.properties.commands.items).toMatchObject({ minProperties: 1, maxProperties: 1 });
  const path = resolve("scripts/edit-batch.schema.json");
  if (process.env["SIDECUT_UPDATE_CLI_SCHEMA"] === "1")
    await writeFile(path, JSON.stringify(schema, null, 2) + "\n");
  expect(JSON.parse(await readFile(path, "utf8"))).toEqual(schema);
});
