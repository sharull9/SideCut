/** What a cloud version records about its file, stored in the version snapshot. */
export type RecordingMetadata = { kind: "studio-recording"; fileName: string; type: string };

export function recordingSnapshot(fileName: string, type: string) {
  return JSON.stringify({ kind: "studio-recording", fileName, type } satisfies RecordingMetadata);
}

/** Older or foreign versions fall back to the library name and a generic video type. */
export function recordingMetadata(snapshot: string, name: string) {
  try {
    const value: unknown = JSON.parse(snapshot);
    if (value && typeof value === "object") {
      const { fileName, type } = value as Partial<RecordingMetadata>;
      if (typeof fileName === "string" && fileName && typeof type === "string" && type)
        return { fileName, type };
    }
  } catch {
    // Not JSON: use the fallback below.
  }
  return { fileName: name, type: "video/mp4" };
}
