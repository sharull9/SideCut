import { createFileRoute } from "@tanstack/react-router";
import { WorkspaceHome } from "@/modules/workspace/workspace-home";

// WorkOS Redirect URI: the Teams dialog opens on `code`/`state` and its AuthKitProvider completes sign-in.
export const Route = createFileRoute("/callback")({ component: WorkspaceHome });
