import { defineAgent, defineDynamic } from "eve";
import { resolveModel } from "./lib/model.ts";

export default defineAgent({
  // Uses Anthropic, OpenAI or OpenRouter, whichever key the user saved.
  model: defineDynamic(() => resolveModel()),
  // No shell, file or web tools: the assistant edits only through the raE.E host tools.
  defaultTools: false,
  compaction: { threshold: 0.8 },
});
