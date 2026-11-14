import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export function createAuthEnv(runtimeEnv: Record<string, string | undefined>) {
  return createEnv({
    server: { WORKOS_CLIENT_ID: z.string().min(1) },
    runtimeEnv: { ...runtimeEnv },
    isServer: true,
    emptyStringAsUndefined: true,
  });
}

// Validate storage only when used, so deployments without R2 can still run other functions.
export function createStorageEnv(runtimeEnv: Record<string, string | undefined>) {
  return createEnv({
    server: {
      R2_ACCOUNT_ID: z.string().regex(/^[a-f0-9]{32}$/),
      R2_ACCESS_KEY_ID: z.string().min(1),
      R2_SECRET_ACCESS_KEY: z.string().min(1),
      R2_BUCKET: z.string().min(1),
    },
    runtimeEnv: { ...runtimeEnv },
    isServer: true,
    emptyStringAsUndefined: true,
    onValidationError: () => {
      throw new Error("Private media storage is not configured.");
    },
  });
}
