import { providerInfo, ProviderError, type Provider } from "./provider.ts";
export function epidemicProvider(): Provider {
  const info = providerInfo(
    "epidemic",
    "Epidemic Sound",
    ["music", "sfx"],
    { notes: ["Upstream provider is a stub. Import licensed downloads through a local folder."] },
    { similar: true },
  );
  info.status = {
    state: "stub",
    message: "Epidemic Sound is not implemented in the pinned reference.",
  };
  const fail = async (): Promise<never> => {
    throw new ProviderError("stub", info.id, info.status.message!);
  };
  return { info, search: fail, fetch: fail, similar: fail };
}
export function lordiconProvider(): Provider {
  const info = providerInfo("lordicon", "Lordicon", ["icon", "sticker"], {
    notes: ["Upstream provider is a stub. Import licensed downloads through a local folder."],
  });
  info.status = { state: "stub", message: "Lordicon is not implemented in the pinned reference." };
  const fail = async (): Promise<never> => {
    throw new ProviderError("stub", info.id, info.status.message!);
  };
  return { info, search: fail, fetch: fail };
}
