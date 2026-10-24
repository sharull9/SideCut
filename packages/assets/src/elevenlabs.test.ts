import { describe, it, expect } from "vite-plus/test";
import refusal from "../../../tests/fixtures/tandem/providers/elevenlabs_missing_permission.json";
import { mockEnvironment } from "./test-support.ts";
import { elevenlabsProvider } from "./elevenlabs.ts";
import { decodeGeneration } from "@sidecut/contracts/providers";
describe("108.10 ElevenLabs and 109 generation", () => {
  it("matches sound request defaults, wraps PCM and preserves completed paid takes on failure", async () => {
    const { env } = mockEnvironment();
    let calls = 0;
    const bodies: unknown[] = [],
      saved: string[] = [];
    env.request = async (r) => {
      calls++;
      bodies.push(JSON.parse(r.body!));
      return {
        status: calls === 1 ? 200 : 500,
        headers: { "character-cost": "20" },
        bytes: new ArrayBuffer(48000),
      };
    };
    const result = await elevenlabsProvider(env).generate!(
      decodeGeneration({ prompt: "click", duration: 0.5, variations: 2, promptInfluence: 0.7 }),
      new AbortController().signal,
      async (take) => {
        saved.push(take.asset.id);
      },
    );
    expect(calls).toBe(2);
    expect(bodies[0]).toEqual({
      text: "click",
      model_id: "eleven_text_to_sound_v2",
      loop: false,
      duration_seconds: 0.5,
      prompt_influence: 0.7,
    });
    expect(saved).toHaveLength(1);
    expect(result.failures).toHaveLength(1);
    expect(new TextDecoder().decode(result.takes[0]!.files[0]!.bytes.slice(0, 4))).toBe("RIFF");
    expect(result.takes[0]!.asset.remote.characterCost).toBe("20");
  });
  it("records missing permissions from the pinned refusal without echoing its body", async () => {
    const { env } = mockEnvironment();
    env.request = async () => ({
      status: 401,
      headers: {},
      bytes: new TextEncoder().encode(JSON.stringify(refusal)).buffer,
    });
    const p = elevenlabsProvider(env);
    await expect(
      p.generate!(
        decodeGeneration({ prompt: "click" }),
        new AbortController().signal,
        async () => {},
      ),
    ).rejects.toMatchObject({ code: "permission" });
    expect((await p.status!()).state).toBe("limited");
  });
  it("never makes a second request after cancellation and keeps the first take", async () => {
    const { env } = mockEnvironment(),
      controller = new AbortController();
    let calls = 0;
    env.request = async () => {
      calls++;
      return { status: 200, headers: {}, bytes: new ArrayBuffer(48000) };
    };
    const result = await elevenlabsProvider(env).generate!(
      decodeGeneration({ prompt: "click", variations: 3 }),
      controller.signal,
      async () => controller.abort(),
    );
    expect(calls).toBe(1);
    expect(result.takes).toHaveLength(1);
    expect(result.failures[0]).toContain("cancelled");
  });
});
