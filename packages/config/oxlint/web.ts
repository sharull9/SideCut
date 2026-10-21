import type { UserConfig } from "vite-plus";
import { builtinModules } from "node:module";
import base from "./base.ts";

const web: NonNullable<UserConfig["lint"]> = {
  ...base,
  plugins: [...(base.plugins ?? []), "react", "jsx-a11y"],
  env: { browser: true },
  rules: {
    ...base.rules,
    "react/rules-of-hooks": "error",
    "react/exhaustive-deps": "warn",
    "jsx-a11y/alt-text": "error",
    "jsx-a11y/anchor-has-content": "error",
    "eslint/no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            group: [
              ...builtinModules,
              "node:*",
              "electron",
              "electron/*",
              "@sidecut/media-native",
              "@sidecut/media-native/*",
            ],
            message: "Use the runtime adapter instead of importing host APIs into browser code.",
          },
        ],
      },
    ],
  },
};

export default web;
