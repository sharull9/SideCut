import { decodeAsset } from "@sidecut/contracts/assets";
import { decodeGeneration } from "@sidecut/contracts/providers";
import {
  ProviderHTTP,
  ProviderError,
  providerInfo,
  url,
  type Provider,
  type ProviderEnvironment,
  type GenerationRequest,
  type FetchedAsset,
} from "./provider.ts";
export function generationBody(r: GenerationRequest) {
  if (r.kind === "music")
    return {
      prompt: r.prompt,
      model_id: r.model ?? "music_v2_5",
      force_instrumental: r.instrumental,
      ...(r.duration != null ? { music_length_ms: Math.round(r.duration * 1000) } : {}),
    };
  return {
    text: r.prompt,
    model_id: r.model ?? "eleven_text_to_sound_v2",
    loop: r.loop,
    ...(r.duration != null ? { duration_seconds: r.duration } : {}),
    ...(r.promptInfluence != null ? { prompt_influence: r.promptInfluence } : {}),
  };
}
export function wrapPCM(bytes: ArrayBuffer, channels: number) {
  const length = bytes.byteLength - (bytes.byteLength % (channels * 2)),
    out = new ArrayBuffer(44 + length),
    view = new DataView(out),
    text = (offset: number, s: string) =>
      new Uint8Array(out, offset, s.length).set(new TextEncoder().encode(s));
  text(0, "RIFF");
  view.setUint32(4, length + 36, true);
  text(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, 48000, true);
  view.setUint32(28, 48000 * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, length, true);
  new Uint8Array(out, 44).set(new Uint8Array(bytes, 0, length));
  return out;
}
export function elevenlabsProvider(env: ProviderEnvironment): Provider {
  const info = providerInfo(
      "elevenlabs",
      "ElevenLabs",
      ["sfx", "music"],
      {
        cacheTTL: 0,
        maxConcurrentRequests: 2,
        notes: [
          "Each variation is a separate paid request. Verify plan terms and current pricing before generation.",
          "Pinned sound-effect estimate: 40 credits per requested second. Music pricing is provider-defined.",
        ],
      },
      { search: false, generate: true },
    ),
    http = new ProviderHTTP(env, info),
    refusals = new Set<string>();
  const status = async () => {
    const base = await http.status();
    if (base.state !== "ready") return base;
    const saved = await env.cacheGet?.("elevenlabs:refusals");
    if (saved && Array.isArray(saved.value))
      for (const permission of saved.value)
        if (typeof permission === "string") refusals.add(permission);
    return refusals.size
      ? {
          state: "limited" as const,
          message: `Missing permissions: ${[...refusals].join(", ")}. Check your key permissions.`,
        }
      : base;
  };
  return {
    info,
    status,
    async search() {
      return [];
    },
    async fetch() {
      throw new ProviderError(
        "unsupported",
        "elevenlabs",
        "Generated assets exist locally. Generate a new take if its file is missing.",
      );
    },
    async generate(input, signal, save) {
      const r = decodeGeneration(input);
      await http.requireReady();
      const takes: FetchedAsset[] = [],
        failures: string[] = [];
      const permission = r.kind === "music" ? "music_generation" : "sound_generation";
      for (let i = 0; i < r.variations; i++) {
        try {
          signal.throwIfAborted();
          const pcm = r.kind === "sfx" && !r.loop,
            format = r.kind === "music" ? "mp3_48000_192" : pcm ? "pcm_48000" : "mp3_44100_128",
            endpoint = r.kind === "music" ? "music" : "sound-generation",
            response = await http.response(
              url(`https://api.elevenlabs.io/v1/${endpoint}`, { output_format: format }),
              signal,
              "POST",
              JSON.stringify(generationBody(r)),
              true,
            );
          const ratio = r.duration ? response.bytes.byteLength / (48000 * 2 * r.duration) : 1,
            channels = ratio >= 1.7 && ratio <= 2.3 ? 2 : 1,
            bytes = pcm ? wrapPCM(response.bytes, channels) : response.bytes;
          if (!response.bytes.byteLength)
            throw new Error("Provider returned an empty generated take.");
          const model = r.model ?? (r.kind === "music" ? "music_v2_5" : "eleven_text_to_sound_v2");
          const asset = decodeAsset({
            provider: "elevenlabs",
            providerID: `${r.kind}_${crypto.randomUUID()}`,
            kind: r.kind,
            name: r.prompt.replace(/\s+/g, " ").slice(0, 60),
            summary: r.prompt,
            tags: ["generated", "elevenlabs"],
            state: "original",
            duration: pcm ? (bytes.byteLength - 44) / (48000 * 2 * channels) : r.duration,
            licenceClass: "aiGenerated",
            licenceName: "ElevenLabs Terms of Service (check plan)",
            pageURL: "https://elevenlabs.io",
            remote: {
              prompt: r.prompt,
              model,
              outputFormat: format,
              variation: String(i + 1),
              ...(r.duration != null ? { requestedDuration: String(r.duration) } : {}),
              ...(r.kind === "sfx"
                ? {
                    loop: r.loop ? "1" : "0",
                    ...(r.promptInfluence != null
                      ? { promptInfluence: String(r.promptInfluence) }
                      : {}),
                  }
                : { instrumental: r.instrumental ? "1" : "0" }),
              ...(response.headers["character-cost"]
                ? { characterCost: response.headers["character-cost"]! }
                : {}),
              ...(response.headers["song-id"] ? { songID: response.headers["song-id"]! } : {}),
            },
          });
          const take = {
            asset,
            files: [
              {
                name: pcm ? "original.wav" : "original.mp3",
                type: pcm ? "audio/wav" : "audio/mpeg",
                bytes,
              },
            ],
          };
          await save(take);
          takes.push(take);
          refusals.delete(permission);
          await env.cachePut?.("elevenlabs:refusals", {
            expires: Number.MAX_SAFE_INTEGER,
            value: [...refusals],
          });
        } catch (e) {
          if (e instanceof ProviderError && e.permission) {
            refusals.add(e.permission);
            await env.cachePut?.("elevenlabs:refusals", {
              expires: Number.MAX_SAFE_INTEGER,
              value: [...refusals],
            });
          }
          if (!takes.length) throw e;
          failures.push(
            `Take ${i + 1}: ${signal.aborted ? "cancelled" : e instanceof Error ? e.message : "generation failed"}`,
          );
          break;
        }
      }
      return { takes, failures };
    },
  };
}
