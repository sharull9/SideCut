import type { UserConfig } from "vite-plus";
import base from "./base.ts";

const desktop: NonNullable<UserConfig["lint"]> = { ...base, env: { node: true } };

export default desktop;
