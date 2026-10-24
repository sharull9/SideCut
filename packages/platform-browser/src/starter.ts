// StarterContent.swift at the pinned Tandem revision. See tests/fixtures/tandem/TANDEM-LICENSE.
import data from "./starter.json";
import { decodeAsset } from "@sidecut/contracts/assets";
import { notoAsset } from "@sidecut/assets";
export function starterAssets() {
  return [
    ...data.noto.map((e) => {
      const asset = notoAsset(e.codepoint, e.tags, [e.category]);
      return {
        ...asset,
        tags: [...asset.tags, "starter"],
        remote: { ...asset.remote, starter: "1" },
      };
    }),
    ...data.icons.map((name) =>
      decodeAsset({
        provider: "iconify",
        providerID: name,
        kind: "icon",
        name: name.split(":")[1]!,
        tags: ["starter", "icon"],
        hasAlpha: true,
        licenceClass: "noCredit",
        licenceName: "Apache-2.0",
        remote: {
          svg: `https://api.iconify.design/${name.replace(":", "/")}.svg?color=%23FFFFFF`,
          starter: "1",
        },
      }),
    ),
    ...data.logos.map((e) =>
      decodeAsset({
        provider: "svgl",
        providerID: e.file,
        kind: "logo",
        name:
          e.title +
          (e.wordmark ? " wordmark" : "") +
          (e.background !== "nil" ? ` (for ${e.background} backgrounds)` : ""),
        tags: [e.title, "logo", ...e.categories, "starter"],
        summary: `${e.title} logo, a trademark of its owner`,
        hasAlpha: true,
        licenceClass: "noCredit",
        remote: { svg: `https://svgl.app/library/${e.file}.svg`, title: e.title, starter: "1" },
      }),
    ),
  ];
}
