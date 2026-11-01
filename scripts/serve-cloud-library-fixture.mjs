import { createServer } from "node:http";
import { createServer as createViteServer } from "vite-plus";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { dirname } from "node:path";
const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const [{ default: react }, { default: tailwindcss }] = await Promise.all(
  ["@vitejs/plugin-react", "@tailwindcss/vite"].map(
    (name) => import(pathToFileURL(require.resolve(name)).href),
  ),
);
const vite = await createViteServer({
  configFile: false,
  root: import.meta.dirname + "/..",
  resolve: {
    alias: {
      react: dirname(require.resolve("react/package.json")),
      "react-dom": dirname(require.resolve("react-dom/package.json")),
    },
  },
  plugins: [react(), tailwindcss()],
  server: { middlewareMode: true },
  optimizeDeps: { noDiscovery: true, include: ["react", "react-dom/client", "react/jsx-runtime"] },
});
const fixture = await vite.ssrLoadModule("/tests/browser/cloud-library-server.ts");
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  if (!url.pathname.startsWith("/__fixture/")) return vite.middlewares(req, res);
  try {
    if (req.method !== "POST") {
      res.writeHead(405).end();
      return;
    }
    let body = "";
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 16384) throw new Error("Request too large");
    }
    if (url.pathname === "/__fixture/fail-next") {
      fixture.failNextUpdate();
      res.writeHead(204).end();
      return;
    }
    if (url.pathname !== "/__fixture/cloud-library") {
      res.writeHead(404).end();
      return;
    }
    const result = await fixture.perform(
      JSON.parse(body),
      url.searchParams.get("role") === "viewer",
    );
    res
      .writeHead(200, { "content-type": "application/json", "cache-control": "no-store" })
      .end(JSON.stringify(result ?? null));
  } catch {
    res
      .writeHead(400, { "content-type": "application/json" })
      .end(JSON.stringify({ error: "Fixture request failed" }));
  }
});
server.listen(4317, "127.0.0.1", () =>
  process.stdout.write(
    "Cloud library fixture: http://127.0.0.1:4317/tests/browser/cloud-library.html\n",
  ),
);
async function close() {
  await vite.close();
  server.close(() => process.exit(0));
}
process.once("SIGINT", close);
process.once("SIGTERM", close);
