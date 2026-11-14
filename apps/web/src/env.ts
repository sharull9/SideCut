import { createWebEnv } from "@sidecut/env/web";

export const env = createWebEnv({
  VITE_CONVEX_URL: import.meta.env.VITE_CONVEX_URL,
  VITE_WORKOS_CLIENT_ID: import.meta.env.VITE_WORKOS_CLIENT_ID,
  VITE_WORKOS_API_HOSTNAME: import.meta.env.VITE_WORKOS_API_HOSTNAME,
  VITE_WORKOS_DEV_MODE: import.meta.env.VITE_WORKOS_DEV_MODE,
  VITE_WORKOS_REDIRECT_URI: import.meta.env.VITE_WORKOS_REDIRECT_URI,
});
