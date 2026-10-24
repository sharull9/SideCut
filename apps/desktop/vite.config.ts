import { defineConfig, type UserConfig } from "vite-plus";

type Pack = Extract<UserConfig["pack"], { entry?: unknown }>;

const shared: Pack = {
  platform: "node",
  target: "node24",
  deps: { neverBundle: ["electron", "ffmpeg-static", "ffprobe-static"] },
};

export default defineConfig({
  pack: [
    { ...shared, entry: { main: "src/main/main.ts" }, format: "esm", clean: true },
    // Sandboxed preload scripts must be CommonJS.
    { ...shared, entry: { preload: "src/preload/preload.ts" }, format: "cjs", clean: false },
  ],
});
