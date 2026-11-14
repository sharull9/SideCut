import { createLandingEnv } from "@sidecut/env/landing";

export const env = createLandingEnv({ VITE_EDITOR_URL: import.meta.env.VITE_EDITOR_URL });
