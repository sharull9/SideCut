import { strFromU8 } from "fflate";
import { list, number, object, text, type ObjectValue } from "./import-builder";
export function filmoraUserData(node: ObjectValue, key: number) {
  const entry = list(node.userData ?? [])
    .map(object)
    .find((e) => e.key === key);
  if (entry == null) return null;
  const encoded = text(entry.data).replace(/\s/g, "");
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded))
    throw new Error("Invalid Filmora userData base64.");
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const decoded: number[] = [];
  let bits = 0,
    buffer = 0;
  for (const character of encoded.replace(/=+$/, "")) {
    buffer = (buffer << 6) | alphabet.indexOf(character);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      decoded.push((buffer >> bits) & 255);
    }
  }
  return Uint8Array.from(decoded);
}
export function filmoraString(node: ObjectValue, key: number) {
  const bytes = filmoraUserData(node, key);
  return bytes == null ? null : strFromU8(bytes).replace(/^\0+|\0+$/g, "") || null;
}
export function linkedVideo(node: ObjectValue) {
  const bytes = filmoraUserData(node, 20);
  if (!bytes?.length || bytes.length > 8) return null;
  const value = bytes.reduce((sum, byte, i) => sum + byte * 256 ** i, 0);
  if (!Number.isSafeInteger(value)) throw new Error("Invalid linked Filmora track index.");
  return value;
}
export function filmoraTicks(value: unknown) {
  const ticks = number(value);
  if (!Number.isSafeInteger(ticks)) throw new Error("Invalid Filmora tick value.");
  return ticks / 10_000_000;
}
