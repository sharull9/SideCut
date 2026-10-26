import { defineConfig } from "vite-plus";
export default defineConfig({
  pack: {
    platform: "node",
    target: "node24",
    entry: { index: "src/index.ts", node: "src/node.ts" },
    format: "esm",
    clean: true,
    dts: false,
    deps: {
      alwaysBundle: [/^@sidecut\/(?:contracts|core)(?:\/|$)/],
      onlyBundle: [/^(commander|zod)$/],
    },
  },
});
