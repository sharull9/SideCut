export async function acquireProjectWriter(projectID: string): Promise<(() => void) | null> {
  if (!navigator.locks)
    throw new Error(
      "This browser cannot coordinate project writers. Use a browser with Web Locks support to edit safely.",
    );
  return new Promise((resolve, reject) => {
    void navigator.locks
      .request(
        `sidecut.project.${projectID}`,
        { mode: "exclusive", ifAvailable: true },
        async (lock) => {
          if (!lock) {
            resolve(null);
            return;
          }
          await new Promise<void>((release) => {
            resolve(release);
          });
        },
      )
      .catch(reject);
  });
}
