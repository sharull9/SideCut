import { defineTestApp } from "convex-test";
import { z } from "zod";
import schema from "../../apps/cloud/src/convex/schema";
import * as teams from "../../apps/cloud/src/convex/teams";
import * as library from "../../apps/cloud/src/convex/library";

const { api, createTest } = defineTestApp({ schema }).defineModules({ teams, library });
const test = createTest();
const identity = {
  subject: "library-browser-owner",
  issuer: "https://api.workos.com/",
  email: "owner@example.test",
  emailVerified: true,
};
const owner = test.withIdentity(identity);
const viewer = test.withIdentity({
  ...identity,
  subject: "library-browser-viewer",
  email: "viewer@example.test",
});
const teamId = await owner.mutation(api.teams.create, { name: "Browser fixture" });
const folderId = await owner.mutation(api.library.createFolder, { teamId, name: "Exports" });
await owner.mutation(api.library.createFolder, { teamId, name: "Reviews" });
for (const name of [
  "Interview final",
  "Camera test",
  "A very long recording name — 资料 🎬 ".repeat(5),
])
  await owner.mutation(api.library.create, { teamId, name, folderId });
const invitationId = await owner.mutation(api.teams.invite, {
  teamId,
  email: "viewer@example.test",
  role: "viewer",
});
await viewer.mutation(api.teams.accept, { invitationId });

const filterSchema = z.object({
  search: z.string().max(200).optional(),
  sort: z.enum(["newest", "name"]),
  archived: z.boolean().optional(),
  folderId: z.string().optional(),
});
const requestSchema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("list"),
    filter: filterSchema,
    cursor: z.string().nullable().optional(),
  }),
  z.object({ operation: z.literal("folder"), name: z.string().min(1).max(200) }),
  z.object({
    operation: z.literal("bulk"),
    mediaIds: z.array(z.string()).min(1).max(100),
    action: z.enum(["move", "archive", "restore"]),
    folderId: z.string().optional(),
  }),
]);
let failNext = false;
export function failNextUpdate() {
  failNext = true;
}

export async function perform(value: unknown, readOnly: boolean) {
  const request = requestSchema.parse(value);
  const actor = readOnly ? viewer : owner;
  if (request.operation !== "list" && failNext) {
    failNext = false;
    throw new Error("Injected transport failure");
  }
  if (request.operation === "folder")
    return actor.mutation(api.library.createFolder, { teamId, name: request.name });
  if (request.operation === "bulk") {
    const destination = await test.run(async (ctx) =>
      request.folderId ? ctx.db.normalizeId("folders", request.folderId) : null,
    );
    if (request.folderId && !destination) throw new Error("Invalid folder ID");
    const mediaIds = await test.run(async (ctx) =>
      request.mediaIds.map((id) => ctx.db.normalizeId("media", id)),
    );
    if (mediaIds.some((id) => id === null)) throw new Error("Invalid media ID");
    return actor.mutation(api.library.bulk, {
      teamId,
      mediaIds: mediaIds.filter((id) => id !== null),
      operation: request.action,
      ...(destination ? { folderId: destination } : {}),
    });
  }
  const folders = await actor.query(api.library.folders, { teamId });
  const folder = request.filter.folderId
    ? folders.find((item) => item._id === request.filter.folderId)
    : undefined;
  if (request.filter.folderId && !folder) throw new Error("Folder unavailable");
  const result = await actor.query(api.library.page, {
    teamId,
    ...(request.filter.search === undefined ? {} : { search: request.filter.search }),
    sort: request.filter.sort,
    ...(request.filter.archived === undefined ? {} : { archived: request.filter.archived }),
    ...(folder ? { folderId: folder._id } : {}),
    paginationOpts: { numItems: 2, cursor: request.cursor ?? null },
  });
  return { folders, items: result.page, cursor: result.continueCursor, done: result.isDone };
}
