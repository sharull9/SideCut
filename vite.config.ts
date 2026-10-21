import { defineConfig } from "vite-plus";
import lint from "@sidecut/config/oxlint/base";
import webLint from "@sidecut/config/oxlint/web";
import desktopLint from "@sidecut/config/oxlint/desktop";
import fmt from "@sidecut/config/oxfmt/base";

const ignored = [
  "**/node_modules/**",
  "**/dist/**",
  "**/.output/**",
  "**/.tanstack/**",
  "**/.nitro/**",
  "**/coverage/**",
  "**/routeTree.gen.ts",
  "pnpm-lock.yaml",
];

export default defineConfig({
  lint: {
    ...lint,
    jsPlugins: webLint.jsPlugins ?? [],
    settings: webLint.settings ?? {},
    ignorePatterns: ignored,
    overrides: [
      {
        files: [
          "apps/web/src/**/*.{ts,tsx}",
          "packages/ui/src/**/*.{ts,tsx}",
          "packages/platform-browser/src/**/*.{ts,tsx}",
        ],
        plugins: webLint.plugins ?? [],
        env: webLint.env ?? {},
        rules: webLint.rules ?? {},
      },
      {
        files: ["**/vite.config.ts", "packages/config/**/*.ts"],
        plugins: desktopLint.plugins ?? [],
        env: desktopLint.env ?? {},
        rules: desktopLint.rules ?? {},
      },
    ],
  },
  fmt: { ...fmt, ignorePatterns: ignored },
  test: {
    include: ["apps/*/src/**/*.test.{ts,tsx}", "packages/*/src/**/*.test.{ts,tsx}"],
    environment: "node",
  },
});
