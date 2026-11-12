// Pure helpers for download responses. Kept out of the "use node" storage module so tests can import them directly.

// Strips characters that are unsafe in a filename on common platforms or in a header value.
export function safeFileName(value: string): string {
  const cleaned = Array.from(value, (char) => {
    const code = char.charCodeAt(0);
    return code < 32 || code === 127 || /[\\/:*?"<>|]/.test(char) ? "_" : char;
  })
    .join("")
    .trim();
  // Cap by code points so an emoji or other surrogate pair is never split.
  const capped = Array.from(cleaned).slice(0, 200).join("").trim();
  return capped || "download";
}

// ASCII fallback for `filename`, plus an RFC 5987 `filename*` carrying the full UTF-8 name.
export function attachmentDisposition(fileName: string): string {
  const fallback = Array.from(fileName, (char) => {
    const code = char.charCodeAt(0);
    return code < 32 || code > 126 || char === '"' || char === "\\" ? "_" : char;
  }).join("");
  // encodeURIComponent leaves ' ( ) * unescaped, but RFC 5987 attr-char does not allow them.
  const encoded = encodeURIComponent(fileName).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
