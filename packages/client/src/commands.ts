import type { EditCommandInput } from "@sidecut/contracts/commands";

export type Command = EditCommandInput;
type Keys<T> = T extends unknown ? keyof T : never;
export type CommandName = Keys<Command>;
export type CommandArgs<K extends CommandName> = Extract<Command, Record<K, unknown>>[K];
type Builders = {
  [K in CommandName]: (args: CommandArgs<K>) => Extract<Command, Record<K, unknown>>;
};

/** Builders preserve JSON inputs; the host validates the complete atomic batch. */
export const cmd = new Proxy({} as Builders, {
  get: (_target, name) =>
    typeof name === "string" ? (args: unknown) => ({ [name]: args }) : undefined,
});
