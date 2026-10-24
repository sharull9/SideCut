import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
const revision = "735a9b8e162c1f951044baa892d94993869f2e77";
const reference = resolve(process.argv[2] ?? join(homedir(), ".cache/sidecut-tandem-reference"));
assert.equal(
  execFileSync("git", ["-C", reference, "rev-parse", "HEAD"], {
    encoding: "utf8",
    windowsHide: true,
  }).trim(),
  revision,
);
const source = async (path) => readFile(join(reference, "Sources", path), "utf8");
const cases = (text) =>
  [...text.matchAll(/^    case (\w+)(?: = "([^"]+)")?/gm)].map((m) => m[2] ?? m[1]);
const commands = cases((await source("TandemCore/Commands.swift")).split("\n}")[0]);
const service = cases((await source("TandemAPI/TandemAPI.swift")).split("public var callType")[0]);
const assets = cases((await source("TandemAPI/AssetTypes.swift")).split("public var callType")[0]);
const tools = [
  ...(await source("TandemAPI/MCPServer.swift")).matchAll(/^            name: "([^"]+)"/gm),
].map((m) => m[1]);
const effects = [
  ...(await source("TandemCore/EffectRegistry.swift")).matchAll(/^            type: "([^"]+)"/gm),
].map((m) => m[1]);
const transitions = cases(
  (await source("TandemCore/Model.swift")).split("public enum TransitionType:")[1].split("\n}")[0],
);
assert.equal(effects.length, 15);
assert.equal(transitions.length, 8);
const fixture = {
  revision,
  provenance:
    "Names extracted from the pinned MIT-licensed upstream; these names do not certify semantic parity.",
  commands,
  service,
  assets,
  tools,
  effects,
  transitions,
};
for (const [key, count] of Object.entries({ commands: 51, service: 34, assets: 11, tools: 43 }))
  assert.equal(fixture[key].length, count, key);
await writeFile(
  resolve(import.meta.dirname, "../tests/fixtures/tandem/pinned-inventory.json"),
  JSON.stringify(fixture, null, 2) + "\n",
);
process.stdout.write(
  JSON.stringify({
    revision,
    counts: {
      commands: commands.length,
      service: service.length,
      assets: assets.length,
      tools: tools.length,
    },
  }) + "\n",
);
