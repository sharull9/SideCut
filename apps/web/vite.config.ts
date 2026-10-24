import { defineConfig, lazyPlugins } from "vite-plus";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";

export default defineConfig({
  resolve: { tsconfigPaths: true },
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
