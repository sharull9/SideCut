import { LiveStudio } from "@sidecut/core/live-studio";

const DIRECTORY = "live-studio";
const fileName = (projectID: string) => `${encodeURIComponent(projectID)}.json`;

/** Scenes live beside the project in origin-private storage. A corrupt file is reported, not replaced. */
export async function loadStudio(projectID: string) {
  const root = await navigator.storage.getDirectory();
  const directory = await root.getDirectoryHandle(DIRECTORY, { create: true });
  let handle: FileSystemFileHandle;
  try {
    handle = await directory.getFileHandle(fileName(projectID));
  } catch (error) {
    if (error instanceof DOMException && error.name === "NotFoundError") return new LiveStudio();
    throw error;
  }
  return LiveStudio.restore(await (await handle.getFile()).text());
}

export async function saveStudio(projectID: string, studio: LiveStudio) {
  const root = await navigator.storage.getDirectory();
  const directory = await root.getDirectoryHandle(DIRECTORY, { create: true });
  const handle = await directory.getFileHandle(fileName(projectID), { create: true });
  const writable = await handle.createWritable();
  try {
    await writable.write(studio.serialize());
    await writable.close();
  } catch (error) {
    await writable.abort().catch(() => {});
    throw error;
  }
}
