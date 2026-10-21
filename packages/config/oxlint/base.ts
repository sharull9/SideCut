import type { UserConfig } from "vite-plus";

const base: NonNullable<UserConfig["lint"]> = {
  plugins: ["eslint", "typescript", "oxc"],
  categories: { correctness: "error", suspicious: "warn" },
  rules: {
    "typescript/consistent-type-imports": "error",
    "typescript/no-explicit-any": "error",
  },
};

export default base;
