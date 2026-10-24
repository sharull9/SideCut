import { chromium, firefox, webkit } from "playwright";
import { resolve } from "node:path";
import { writeFile } from "node:fs/promises";
import assert from "node:assert/strict";

const base = process.env.SIDECUT_VERIFY_URL ?? "http://127.0.0.1:4270";
const root = resolve(import.meta.dirname, "..").replaceAll("\\", "/");
const pageUrl = `${base}/@fs/${root}/tests/browser/sqlite.html`;
const moduleUrl = `/@fs/${root}/tests/browser/sqlite.js`;
const results = [];
for (const [name, engine] of Object.entries({ chromium, firefox, webkit })) {
  const browser = await engine.launch();
  const result = { engine: name, version: browser.version(), passed: [], errors: [] };
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(pageUrl);
    const invoke = (targetPage, method, args = []) =>
      targetPage.evaluate(
        async (input) => (await import(input.moduleUrl))[input.method](...input.args),
        { moduleUrl, method, args },
      );
    result.opfs = await page.evaluate(async () => {
      try {
        const directory = await navigator.storage.getDirectory();
        await directory.getDirectoryHandle("probe", { create: true });
        return "available";
      } catch (error) {
        return `${error.name}: ${error.message}`;
      }
    });
    await invoke(page, "seedLegacy");
    const migration = await invoke(page, "verifyMigration");
    result.passed.push(...migration.passed);
    await page.reload();
    assert.equal(await invoke(page, "verifyReopen"), true);
    result.passed.push("projects, media, libraries and preferences survive page restart");
    const peer = await context.newPage();
    await peer.goto(pageUrl);
    const writes = await Promise.all([
      invoke(page, "concurrentWrite", ["race", null, "one"]),
      invoke(peer, "concurrentWrite", ["race", null, "two"]),
    ]);
    assert.deepEqual(writes.sort(), ["committed", "conflict"]);
    result.passed.push("two tabs serialize SQLite access and reject stale compare-and-swap");
    await context.close();
    const damaged = await browser.newContext(),
      repair = await damaged.newPage();
    await repair.goto(pageUrl);
    await invoke(repair, "seedLegacy", [true]);
    assert.equal(await invoke(repair, "verifyDamagedMigration"), true);
    result.passed.push("damaged legacy data blocks writes and can be repaired and retried");
    await damaged.close();
    result.accepted = true;
  } catch (error) {
    result.accepted = false;
    result.errors.push(error.message);
  } finally {
    await browser.close();
    results.push(result);
    process.stdout.write(JSON.stringify(result) + "\n");
  }
}
await writeFile(
  resolve(root, "docs/verification/sqlite-browsers.json"),
  JSON.stringify(
    { testedAt: new Date().toISOString(), source: "Vite-served isolated browser modules", results },
    null,
    2,
  ) + "\n",
);
if (results.some((r) => !r.accepted)) process.exitCode = 1;
