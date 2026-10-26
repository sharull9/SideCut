export function analysisText(operation: string, result: Record<string, unknown>): string;
export function prepareAnalysisCommand(parsed: { flags: Map<string, unknown>; words: string[] }):
  | {
      flags: Map<string, unknown>;
      words: string[];
      execute?: (
        call: (
          name: string,
          input: Record<string, unknown>,
        ) => Promise<Record<string, unknown> | null>,
      ) => Promise<Record<string, unknown> | string | null>;
      prepare(input: Record<string, unknown>): Record<string, unknown>;
      text: ((result: Record<string, unknown>) => string) | undefined;
    }
  | undefined;
