import { defineConfig, lazyPlugins } from "vite-plus";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  // Prerender requests must use the same loopback address as the preview server.
  preview: { host: "127.0.0.1" },
  plugins:
    lazyPlugins(() => [
      tailwindcss(),
      tanstackStart({ prerender: { enabled: true, crawlLinks: true } }),
      nitro(),
      viteReact(),
    ]) ?? [],
});
