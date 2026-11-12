import { describe, expect, it } from "vite-plus/test";
import { attachmentDisposition, safeFileName } from "./downloadName";

describe("safeFileName", () => {
  it("replaces path separators and reserved characters", () => {
    expect(safeFileName("a/b\\c.mp4")).toBe("a_b_c.mp4");
    expect(safeFileName('x:y*z?"<>|.mp4')).toBe("x_y_z_____.mp4");
  });

  it("trims surrounding whitespace", () => {
    expect(safeFileName("  render.mp4  ")).toBe("render.mp4");
  });

  it("falls back to a fixed name when nothing usable remains", () => {
    expect(safeFileName("")).toBe("download");
    expect(safeFileName("   ")).toBe("download");
  });

  it("caps the name at 200 characters", () => {
    expect(safeFileName("x".repeat(300))).toHaveLength(200);
  });

  it("counts code points rather than UTF-16 units when capping", () => {
    const result = safeFileName("😀".repeat(300));
    expect(Array.from(result)).toHaveLength(200);
    expect(result).toBe("😀".repeat(200));
  });
});

describe("attachmentDisposition", () => {
  it("emits plain ASCII names unchanged in both parameters", () => {
    expect(attachmentDisposition("render.mp4")).toBe(
      `attachment; filename="render.mp4"; filename*=UTF-8''render.mp4`,
    );
  });

  it("keeps an ASCII fallback and a UTF-8 encoded name for non-ASCII input", () => {
    expect(attachmentDisposition("Café.mp4")).toBe(
      `attachment; filename="Caf_.mp4"; filename*=UTF-8''Caf%C3%A9.mp4`,
    );
  });

  it("escapes quotes so the quoted fallback stays well-formed", () => {
    expect(attachmentDisposition('a"b.mp4')).toBe(
      `attachment; filename="a_b.mp4"; filename*=UTF-8''a%22b.mp4`,
    );
  });

  it("percent-encodes characters that encodeURIComponent leaves alone", () => {
    expect(attachmentDisposition("it's (1)*.mp4")).toBe(
      `attachment; filename="it's (1)*.mp4"; filename*=UTF-8''it%27s%20%281%29%2A.mp4`,
    );
  });
});
