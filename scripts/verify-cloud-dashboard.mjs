// Production dashboard navigation, local-project retention and responsive acceptance.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, join, relative, isAbsolute, extname } from "node:path";
import { chromium } from "playwright";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, "..");
const publicRoot = join(root, "apps/web/.output/public");
const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".woff2": "font/woff2",
};
const server = createServer(async (req, res) => {
  const file = resolve(
    publicRoot,
    "." + decodeURIComponent(new URL(req.url, "http://localhost").pathname),
  );
  const path = relative(publicRoot, file);
  if (path.startsWith("..") || isAbsolute(path)) return res.writeHead(403).end();
  try {
    let data, extension;
    try {
      data = await readFile(file);
      extension = extname(file);
    } catch {
      data = await readFile(join(publicRoot, "_shell.html"));
      extension = ".html";
    }
    res.writeHead(200, { "content-type": mime[extension] ?? "application/octet-stream" }).end(data);
  } catch {
    res.writeHead(500).end();
  }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const url = `http://127.0.0.1:${server.address().port}`;
const result = {
  testedAt: new Date().toISOString(),
  production: true,
  configured: false,
  checks: {},
  errors: [],
  accepted: false,
};
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on("pageerror", (error) => result.errors.push(error.message));
  await page.goto(url);
  await page.getByTestId("project-name").waitFor();
  await page.getByRole("status").filter({ hasText: "Saved in browser" }).waitFor();
  const original = await page.getByTestId("project-name").innerText();
  await page.getByRole("link", { name: "Cloud", exact: true }).click();
  await page.getByRole("heading", { name: "Overview", exact: true }).waitFor();
  const nav = page.getByRole("navigation", { name: "Cloud navigation" });
  assert.equal(await nav.getByRole("link").count(), 6);
  assert.equal(await nav.locator('[aria-current="page"]').innerText(), "Overview");
  result.checks.editorEntry = true;
  await page.screenshot({
    path: join(root, "docs/verification/lawn-videorc-cloud-dashboard-desktop.png"),
    fullPage: true,
  });
  for (const name of ["Library", "Team"]) {
    await nav.getByRole("link", { name, exact: true }).click();
    await page.getByRole("heading", { level: 1, name, exact: true }).waitFor();
    await page
      .getByText("Cloud teams are not configured for this app.", { exact: false })
      .waitFor();
    assert.equal(await nav.locator('[aria-current="page"]').innerText(), name);
  }
  result.checks.unconfiguredAccountAndLibrary = true;
  for (const name of ["Reviews", "Publishing", "Usage"]) {
    await nav.getByRole("link", { name, exact: true }).click();
    await page.getByRole("heading", { name: `${name} tools are not available yet` }).waitFor();
    assert.equal(await page.getByRole("button").count(), 0);
  }
  result.checks.unavailableServicesExplicit = true;
  await page.goBack();
  await page.getByRole("heading", { level: 1, name: "Publishing", exact: true }).waitFor();
  await page.goForward();
  await page.getByRole("heading", { level: 1, name: "Usage", exact: true }).waitFor();
  result.checks.history = true;
  await page.goto(`${url}/cloud?section=invalid`);
  await page.getByRole("heading", { level: 1, name: "Overview", exact: true }).waitFor();
  result.checks.invalidSectionFallsBack = true;
  // Start with fresh focus; reload can restore focus to a previously visited link.
  await page.goto("about:blank");
  await page.goto(`${url}/cloud`);
  await page.getByRole("heading", { level: 1, name: "Overview", exact: true }).waitFor();
  await page.keyboard.press("Tab");
  assert.equal(
    await page
      .getByRole("link", { name: "Skip to content" })
      .evaluate((e) => e === document.activeElement),
    true,
  );
  await page.keyboard.press("Enter");
  assert.equal(await page.locator("main").evaluate((e) => e === document.activeElement), true);
  result.checks.keyboardSkip = true;
  await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  const violations = await page.evaluate(async () =>
    (await axe.run()).violations
      .filter((v) => ["serious", "critical"].includes(v.impact))
      .map((v) => ({ id: v.id, impact: v.impact })),
  );
  assert.deepEqual(violations, []);
  result.checks.accessibility = { seriousOrCritical: violations };
  result.checks.widths = [];
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    const bounds = await page.evaluate(() => ({
      viewport: innerWidth,
      document: document.documentElement.scrollWidth,
    }));
    assert.ok(bounds.document <= width, JSON.stringify(bounds));
    for (const link of await nav.getByRole("link").all()) assert.ok(await link.isVisible());
    result.checks.widths.push(bounds);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await page.screenshot({
    path: join(root, "docs/verification/lawn-videorc-cloud-dashboard-mobile.png"),
    fullPage: true,
  });
  await nav.getByRole("link", { name: "Team", exact: true }).click();
  await page.getByText("Cloud teams are not configured for this app.", { exact: false }).waitFor();
  const mobileWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  assert.ok(mobileWidth <= 390);
  result.checks.mobileAccount = true;
  await page.getByRole("link", { name: "Back to editor", exact: true }).click();
  await page.getByTestId("project-name").waitFor();
  assert.equal(await page.getByTestId("project-name").innerText(), original);
  await page.getByRole("button", { name: "Teams", exact: true }).click();
  await page.getByRole("dialog", { name: "Teams", exact: true }).waitFor();
  await page.getByText("Cloud teams are not configured for this app.", { exact: false }).waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  result.checks.editorReturnAndLegacyTeams = true;
  assert.deepEqual(result.errors, []);
  result.accepted = true;
} catch (error) {
  result.failure = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
  await writeFile(
    join(root, "docs/verification/lawn-videorc-cloud-dashboard.json"),
    JSON.stringify(result, null, 2) + "\n",
  );
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}
