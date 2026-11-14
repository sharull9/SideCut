import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export function createWebEnv(runtimeEnv: Record<string, string | undefined>) {
  return createEnv({
    clientPrefix: "VITE_",
    client: {
      VITE_CONVEX_URL: z.url({ protocol: /^https?$/ }).optional(),
      VITE_WORKOS_CLIENT_ID: z.string().min(1).optional(),
      VITE_WORKOS_API_HOSTNAME: z.hostname().optional(),
      VITE_WORKOS_DEV_MODE: z.enum(["true", "false"]).optional(),
      VITE_WORKOS_REDIRECT_URI: z.url({ protocol: /^https?$/ }).optional(),
    },
    runtimeEnv: { ...runtimeEnv },
    emptyStringAsUndefined: true,
  });
}
