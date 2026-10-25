export function queryHelp(topic?: string): string | undefined;
export function clock(seconds: number): string;
export function queryText(operation: string, result: Record<string, unknown>): string;
export function prepareQueryCommand(parsed: { flags: Map<string, unknown>; words: string[] }):
  | {
      flags: Map<string, unknown>;
      words: string[];
      operation: string;
      revisionOnly: boolean;
      make: boolean;
      timeout: number | undefined;
      prepare(input: Record<string, unknown>): Record<string, unknown>;
      text: ((result: Record<string, unknown>) => string) | undefined;
    }
  | undefined;
