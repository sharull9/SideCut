export function applyText(result: Record<string, unknown>): string;
export function prepareApplyCommand(parsed: {
  flags: Map<string, unknown>;
  words: string[];
}): Promise<
  | {
      flags: Map<string, unknown>;
      words: string[];
      prepare(input: Record<string, unknown>): Record<string, unknown>;
      text: ((result: Record<string, unknown>) => string) | undefined;
    }
  | undefined
>;
