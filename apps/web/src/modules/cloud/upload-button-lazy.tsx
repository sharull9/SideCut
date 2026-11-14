import { lazy, Suspense, type ComponentProps } from "react";
import { useCloud } from "./cloud-context";
import type { UploadToCloudButton as UploadToCloudButtonImpl } from "./upload-button";

// Keeps Convex out of the editor's entry bundle. The real button is fetched on first render,
// and only when cloud is configured. Self-hosted builds never request the chunk.
const LazyUploadToCloudButton = lazy(() =>
  import("./upload-button").then((m) => ({ default: m.UploadToCloudButton })),
);

export function UploadToCloudButton(props: ComponentProps<typeof UploadToCloudButtonImpl>) {
  const { configured } = useCloud();
  if (!configured) return null;
  return (
    <Suspense fallback={null}>
      <LazyUploadToCloudButton {...props} />
    </Suspense>
  );
}
