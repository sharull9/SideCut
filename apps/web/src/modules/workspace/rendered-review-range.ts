export function validReviewRange(start: number, duration: number, versionDuration: number) {
  return (
    Number.isFinite(start) &&
    Number.isFinite(duration) &&
    Number.isFinite(versionDuration) &&
    start >= 0 &&
    duration >= 0 &&
    start < versionDuration &&
    start + duration <= versionDuration
  );
}
