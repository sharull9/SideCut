import { defineConfig, lazyPlugins } from "vite-plus";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  plugins:
    lazyPlugins(() => [
      tailwindcss(),
      tanstackStart({ spa: { enabled: true } }),
      nitro(),
      viteReact(),
    ]) ?? [],
});
