import { defineConfig, lazyPlugins } from "vite-plus";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  // SPA prerender requests must use the same loopback address as the preview server.
  preview: { host: "127.0.0.1" },
  // First transcription must not reload the editor while its worker is running.
  optimizeDeps: { include: ["@sidecut/platform-browser > @huggingface/transformers"] },
  plugins:
    lazyPlugins(() => [
      tailwindcss(),
      tanstackStart({ spa: { enabled: true } }),
      nitro(),
      viteReact(),
    ]) ?? [],
});
