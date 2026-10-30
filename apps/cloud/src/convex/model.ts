import { mutationGeneric, queryGeneric } from "convex/server";
import type {
  DataModelFromSchemaDefinition,
  GenericMutationCtx,
  GenericQueryCtx,
  MutationBuilder,
  QueryBuilder,
} from "convex/server";
import type schema from "./schema";

export type DataModel = DataModelFromSchemaDefinition<typeof schema>;
export type QueryCtx = GenericQueryCtx<DataModel>;
export type MutationCtx = GenericMutationCtx<DataModel>;
export const query: QueryBuilder<DataModel, "public"> = queryGeneric;
export const mutation: MutationBuilder<DataModel, "public"> = mutationGeneric;
