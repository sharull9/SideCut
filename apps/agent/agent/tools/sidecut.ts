import { defineDynamic, defineTool, toolOutput, toolOutputPart } from "eve/tools";
import { needsApproval } from "../lib/approval.ts";
import { callHostTool, hostTools, modelSchema, type ToolContent } from "../lib/host.ts";

/** Exposes every raE.E host tool (the same set as the MCP server) to the assistant. */
export default defineDynamic(() =>
  Object.fromEntries(
    hostTools.map((tool) => [
      tool.name,
      defineTool({
        description: tool.description,
        inputSchema: modelSchema(tool.inputSchema),
        label: { start: () => tool.title },
        approval: ({ toolInput }) =>
          needsApproval(
            tool.name,
            toolInput as Record<string, unknown> | undefined,
            tool.annotations,
          )
            ? "user-approval"
            : "not-applicable",
        async execute(input, ctx): Promise<{ content: ToolContent[] }> {
          return {
            content: await callHostTool(
              tool.name,
              input as Record<string, unknown>,
              ctx.abortSignal,
            ),
          };
        },
        toModelOutput(output) {
          const { content } = output as { content: ToolContent[] };
          const [first] = content;
          if (content.length === 1 && first?.type === "text") return toolOutput.text(first.text);
          return toolOutput.content(
            content.map((part) =>
              part.type === "image"
                ? toolOutputPart.file(part.data, { mediaType: part.mimeType })
                : toolOutputPart.text(part.text),
            ),
          );
        },
      }),
    ]),
  ),
);
