import { cp, copyFile, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";

// Keep the desktop/Nitro build intact; Cloudflare SPA routing requires index.html.
const source = new URL("../apps/web/.output/public/", import.meta.url);
const destination = new URL("../apps/web/.cloudflare/", import.meta.url);
await access(new URL("_shell.html", source));
await cp(source, destination, { recursive: true });
await copyFile(new URL("_shell.html", source), new URL("index.html", destination));
process.stdout.write(`Prepared Cloudflare static assets at ${fileURLToPath(destination)}\n`);
