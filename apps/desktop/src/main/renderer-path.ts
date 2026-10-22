import { extname, join, normalize, relative, sep } from "node:path";

export const shellFile = "_shell.html";

/**
 * Maps a renderer URL path to a file under `root`. Paths without an extension are
 * application routes and resolve to the SPA shell. Returns undefined for paths that
 * escape the root.
 */
export const resolveRendererPath = (root: string, pathname: string): string | undefined => {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return undefined;
  }
  if (decoded.includes("\0")) return undefined;
  const file = normalize(join(root, decoded));
  const inside = relative(root, file);
  if (inside.startsWith("..") || inside.includes(`..${sep}`)) return undefined;
  if (inside === "" || extname(inside) === "") return join(root, shellFile);
  return file;
};
