import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export function createLandingEnv(runtimeEnv: Record<string, string | undefined>) {
  return createEnv({
    clientPrefix: "VITE_",
    client: { VITE_EDITOR_URL: z.url({ protocol: /^https?$/ }).optional() },
    runtimeEnv: { ...runtimeEnv },
    emptyStringAsUndefined: true,
  });
}
