export function resourceText(operation: string, result: Record<string, unknown>): string;
export function prepareResourceCommand(parsed: { flags: Map<string, unknown>; words: string[] }):
  | {
      flags: Map<string, unknown>;
      words: string[];
      offline?: () => Promise<Record<string, unknown>>;
      prepare(input: Record<string, unknown>): Record<string, unknown>;
      text: ((result: Record<string, unknown>) => string) | undefined;
    }
  | undefined;
