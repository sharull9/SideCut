import { Schema } from "effect";

export const assetKinds = [
  "music",
  "sfx",
  "sticker",
  "overlay",
  "video",
  "image",
  "font",
  "icon",
  "logo",
  "lut",
  "title",
  "transition",
] as const;
export const licenceClasses = [
  "noCredit",
  "creditNeeded",
  "subscription",
  "aiGenerated",
  "unknown",
] as const;
const optional = <S extends Schema.Constraint>(s: S) => Schema.optionalKey(Schema.NullOr(s));
const AssetSchema = Schema.StructWithRest(
  Schema.Struct({
    id: optional(Schema.String),
    provider: Schema.String,
    providerID: Schema.String,
    kind: Schema.Literals(assetKinds),
    name: optional(Schema.String),
    tags: optional(Schema.Array(Schema.String)),
    summary: optional(Schema.String),
    licenceClass: optional(Schema.Literals(licenceClasses)),
    creditLine: optional(Schema.String),
    licenceName: optional(Schema.String),
    fontFamily: optional(Schema.String),
    remote: optional(Schema.Record(Schema.String, Schema.String)),
    previewURL: optional(Schema.String),
    thumbnailURL: optional(Schema.String),
    updatedAt: optional(Schema.String),
    pageURL: optional(Schema.String),
    state: optional(Schema.Literals(["remote", "preview", "original", "normalised"])),
    hasAlpha: optional(Schema.Boolean),
    width: optional(Schema.Finite),
    height: optional(Schema.Finite),
    duration: optional(Schema.Finite),
    sha256: optional(Schema.String),
    files: optional(
      Schema.StructWithRest(
        Schema.Struct({
          folder: optional(Schema.String),
          original: optional(Schema.String),
          normalised: optional(Schema.String),
          licence: optional(Schema.String),
        }),
        [Schema.Record(Schema.String, Schema.Unknown)],
      ),
    ),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
);

export function decodeAsset(input: unknown) {
  const json =
    input && typeof input === "object" && !Array.isArray(input)
      ? Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined))
      : input;
  const a = Schema.decodeUnknownSync(AssetSchema)(json);
  if (!a.provider.trim() || !a.providerID.trim())
    throw new Error("Asset provider and provider ID must not be empty.");
  if (a.id && a.id !== `${a.provider}:${a.providerID}`)
    throw new Error("Asset identity does not match its provider.");
  for (const [key, path] of Object.entries(a.files ?? {}))
    if (
      typeof path === "string" &&
      (path.includes("\\") ||
        path.startsWith("/") ||
        path.split("/").some((p) => !p || p === ".." || p === ".") ||
        path.includes(":"))
    )
      throw new Error(`Asset ${key} must be a relative library path.`);
  if (a.pageURL && !/^https?:\/\//i.test(a.pageURL))
    throw new Error("Asset page must be an HTTP or HTTPS URL.");
  for (const key of ["width", "height", "duration"] as const)
    if (a[key] != null && a[key]! <= 0) throw new Error(`Asset ${key} must be positive.`);
  return {
    ...a,
    id: a.id ?? `${a.provider}:${a.providerID}`,
    name: a.name ?? a.providerID,
    tags: a.tags ?? [],
    licenceClass: a.licenceClass ?? "unknown",
    state: a.state ?? "remote",
    hasAlpha: a.hasAlpha ?? false,
    files: a.files ?? {},
    remote: a.remote ?? {},
  };
}
export type Asset = ReturnType<typeof decodeAsset>;
export function searchAssets(assets: readonly Asset[], query: string, kind = "", licence = "") {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return assets
    .filter(
      (a) =>
        (!kind || a.kind === kind) &&
        (!licence || a.licenceClass === licence) &&
        words.every((w) =>
          [a.name, a.provider, a.providerID, a.summary ?? "", ...a.tags]
            .join(" ")
            .toLocaleLowerCase()
            .includes(w),
        ),
    )
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}
