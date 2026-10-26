export function libraryText(operation: string, result: Record<string, unknown>): string;
export function prepareLibraryCommand(parsed: { flags: Map<string, unknown>; words: string[] }):
  | {
      flags: Map<string, unknown>;
      words: string[];
      prepare(input: Record<string, unknown>): Record<string, unknown>;
      text: ((result: Record<string, unknown>) => string) | undefined;
    }
  | undefined;
