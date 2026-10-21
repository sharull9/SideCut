import type { UserConfig } from "vite-plus";

const base: NonNullable<UserConfig["fmt"]> = {
  endOfLine: "lf",
  semi: true,
  singleQuote: false,
  tabWidth: 2,
  trailingComma: "all",
  printWidth: 100,
};

export default base;
