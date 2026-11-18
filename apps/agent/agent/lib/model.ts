/** Which model provider the assistant uses, picked from whichever API key the user saved. */
export type AssistantProvider = "anthropic" | "openai" | "openrouter";

export const providers: readonly AssistantProvider[] = ["anthropic", "openai", "openrouter"];

export const providerKeyEnv: Record<AssistantProvider, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
};

type Env = Record<string, string | undefined>;

/**
 * eve needs a context window for models outside its catalog (custom or less common OpenRouter
 * IDs). A conservative shared value works for every default and keeps compaction predictable.
 */
export const contextWindowTokens = 200_000;

/**
 * The provider and model the user configured in the Assistant panel. Nothing is picked for
 * them: without an explicit provider, model and that provider's key, the assistant won't run.
 */
export function selectModel(env: Env): { provider: AssistantProvider; model: string } | undefined {
  const provider = env.SIDECUT_AGENT_PROVIDER as AssistantProvider | undefined;
  const model = env.SIDECUT_AGENT_MODEL?.trim();
  if (!provider || !providers.includes(provider) || !model) return undefined;
  if (!env[providerKeyEnv[provider]]?.trim()) return undefined;
  return { provider, model };
}

export async function resolveModel(env: Env = process.env) {
  return { model: await providerModel(env), modelContextWindowTokens: contextWindowTokens };
}

async function providerModel(env: Env) {
  const selected = selectModel(env);
  if (!selected)
    throw new Error(
      "The assistant isn't set up. Choose a provider, model and API key in the Assistant panel.",
    );
  const { provider, model: id } = selected;
  if (provider === "anthropic") {
    const { anthropic } = await import("eve/models/anthropic");
    return anthropic(id);
  }
  if (provider === "openai") {
    const { openai } = await import("eve/models/openai");
    return openai(id);
  }
  const { createOpenRouter } = await import("@openrouter/ai-sdk-provider");
  return createOpenRouter({
    apiKey: env.OPENROUTER_API_KEY ?? "",
    // Lets the smoke test (or an OpenRouter-compatible gateway) stand in for openrouter.ai.
    ...(env.OPENROUTER_BASE_URL ? { baseURL: env.OPENROUTER_BASE_URL } : {}),
  }).chat(id);
}
