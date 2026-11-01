import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, join, relative, isAbsolute, extname } from "node:path";
import assert from "node:assert/strict";

const root = resolve(import.meta.dirname, "../apps/web/.cloudflare");
const configured = process.env.SIDECUT_CLOUD_CONFIGURED === "1";
const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".wasm": "application/wasm",
};
const server = createServer(async (request, response) => {
  try {
    const file = resolve(root, `.${new URL(request.url, "http://localhost").pathname}`);
    const path = relative(root, file);
    if (path.startsWith("..") || isAbsolute(path)) {
      response.writeHead(403).end();
      return;
    }
    let data, extension;
    try {
      data = await readFile(file);
      extension = extname(file);
    } catch {
      data = await readFile(join(root, "index.html"));
      extension = ".html";
    }
    response
      .writeHead(200, {
        "content-type": mime[extension] ?? "application/octet-stream",
      })
      .end(data);
  } catch {
    response.writeHead(500).end();
  }
});
await new Promise((done, reject) => {
  server.once("error", reject);
  server.listen(configured ? 3000 : 0, "127.0.0.1", done);
});
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  await page.goto(`http://${configured ? "localhost" : "127.0.0.1"}:${address.port}`);
  const trigger = page.getByRole("button", { name: "Teams", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Teams", exact: true });
  await dialog
    .getByText(
      configured
        ? "Sign in to create a team or accept an invitation."
        : "Cloud teams are not configured for this app.",
      { exact: false },
    )
    .waitFor();
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  assert.equal(await trigger.evaluate((element) => element === document.activeElement), true);
  await trigger.click();
  await dialog.waitFor();
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  await page.setViewportSize({ width: 390, height: 844 });
  await trigger.click();
  await dialog.waitFor();
  const bounds = await dialog.boundingBox();
  assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 391);
  await page.screenshot({
    path: "logs/lv012-teams-mobile.png",
    animations: "disabled",
  });
  if (configured) {
    await dialog.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL(
      (url) => url.hostname.endsWith("authkit.app") || url.hostname === "api.workos.com",
      { timeout: 30000 },
    );
  }
  await page.keyboard.press("Escape");
  assert.deepEqual(errors, []);
  process.stdout.write(
    `Teams production smoke passed: ${configured ? "configured sign-in and WorkOS redirect" : "unconfigured state"}, reopen, Escape, focus return, mobile bounds, no page errors.\n`,
  );
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
}
