import { createFileRoute } from "@tanstack/react-router";
import { WorkspaceHome } from "@/modules/workspace/workspace-home";

export const Route = createFileRoute("/")({ component: WorkspaceHome });
