import { Time } from "@sidecut/contracts/time";

// Tag every composite value so user objects cannot collide with file references.
interface FileStorage {
  putFile(bytes: Uint8Array): Promise<string>;
  getFile(id: string): Promise<Uint8Array<ArrayBuffer>>;
}
export async function encodeStored(
  value: unknown,
  storage: Pick<FileStorage, "putFile">,
): Promise<string> {
  const encode = async (v: unknown): Promise<unknown> => {
    if (v instanceof Time) return v.toJSON();
    if (
      v === null ||
      typeof v === "string" ||
      typeof v === "boolean" ||
      (typeof v === "number" && Number.isFinite(v))
    )
      return v;
    if (v instanceof Blob)
      return [
        "file",
        await storage.putFile(new Uint8Array(await v.arrayBuffer())),
        v.type,
        v instanceof File ? v.name : null,
        v instanceof File ? v.lastModified : 0,
      ];
    if (v instanceof ArrayBuffer) return ["buffer", await storage.putFile(new Uint8Array(v))];
    if (ArrayBuffer.isView(v))
      return [
        "view",
        v.constructor.name,
        await storage.putFile(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)),
      ];
    if (Array.isArray(v)) return ["array", await Promise.all(v.map(encode))];
    if (v && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype)
      return [
        "object",
        await Promise.all(
          Object.entries(v)
            .filter(([, val]) => val !== undefined)
            .map(async ([key, val]) => [key, await encode(val)]),
        ),
      ];
    throw new Error("Unsupported value in SQLite storage.");
  };
  return JSON.stringify(await encode(value));
}

export async function decodeStored(
  json: string,
  storage: Pick<FileStorage, "getFile">,
): Promise<unknown> {
  const decode = async (v: unknown): Promise<unknown> => {
    if (v === null || typeof v === "string" || typeof v === "boolean" || typeof v === "number")
      return v;
    if (!Array.isArray(v)) throw new Error("Invalid stored value.");
    const [kind, first, second, third, fourth] = v;
    if (kind === "array" && Array.isArray(first)) return Promise.all(first.map(decode));
    if (kind === "object" && Array.isArray(first)) {
      const entries = await Promise.all(
        first.map(async (entry: unknown) => {
          if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string")
            throw new Error("Invalid stored object.");
          return [entry[0], await decode(entry[1])];
        }),
      );
      return Object.fromEntries(entries);
    }
    if (kind === "file" && typeof first === "string" && typeof second === "string") {
      const bytes = await storage.getFile(first);
      if (third === null) return new Blob([bytes], { type: second });
      if (typeof third === "string" && typeof fourth === "number")
        return new File([bytes], third, { type: second, lastModified: fourth });
    }
    if (kind === "buffer" && typeof first === "string")
      return (await storage.getFile(first)).buffer;
    if (kind === "view" && typeof first === "string" && typeof second === "string") {
      const buffer = (await storage.getFile(second)).buffer;
      switch (first) {
        case "Uint8Array":
          return new Uint8Array(buffer);
        case "Uint8ClampedArray":
          return new Uint8ClampedArray(buffer);
        case "Int8Array":
          return new Int8Array(buffer);
        case "Int16Array":
          return new Int16Array(buffer);
        case "Uint16Array":
          return new Uint16Array(buffer);
        case "Int32Array":
          return new Int32Array(buffer);
        case "Uint32Array":
          return new Uint32Array(buffer);
        case "Float32Array":
          return new Float32Array(buffer);
        case "Float64Array":
          return new Float64Array(buffer);
        case "DataView":
          return new DataView(buffer);
      }
    }
    throw new Error("Invalid stored file reference.");
  };
  return decode(JSON.parse(json));
}
