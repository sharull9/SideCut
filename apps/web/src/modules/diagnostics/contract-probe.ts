import { decodeProjectFile, encodeProjectFile } from "@sidecut/contracts/project";
import { Time } from "@sidecut/contracts/time";
import empty from "../../../../../tests/fixtures/tandem/empty.json";
import mini from "../../../../../tests/fixtures/tandem/mini.json";

export function runContractProbe() {
  const file = decodeProjectFile(mini);
  const encoded = encodeProjectFile(file);
  const second = encodeProjectFile(decodeProjectFile(JSON.parse(encoded)));
  if (encoded !== second) throw new Error("Project round trip changed the fixture.");
  const defaults = decodeProjectFile(empty).project.settings;
  if (defaults.width !== 3840 || defaults.sampleRate !== 48_000)
    throw new Error("Reference defaults differ.");
  const negativeHalf = Time.fromSeconds(-0.5 / 48_000);
  if (negativeHalf.flicks !== -14_700n) throw new Error("Negative half-sample rounding differs.");
  const sample = Time.fromSeconds(123.456789);
  if (Time.fromSeconds(JSON.parse(JSON.stringify(sample))).flicks !== sample.flicks)
    throw new Error("Sample round trip changed time.");
  let rejectsFuture = false;
  try {
    decodeProjectFile({ revision: 0, project: { schemaVersion: 99 } });
  } catch {
    rejectsFuture = true;
  }
  if (!rejectsFuture) throw new Error("Future schema version was accepted.");
  return {
    passed: true,
    schemaVersion: file.project.schemaVersion,
    revision: file.revision,
    projectId: file.project.id,
    media: file.project.media.length,
    videoTracks: file.project.videoTracks.length,
    audioTracks: file.project.audioTracks.length,
    contentVariants: [
      ...new Set(
        file.project.videoTracks.flatMap((t) => t.clips.map((c) => Object.keys(c.content)[0])),
      ),
    ],
    roundTrip: "passed",
    negativeHalfSampleFlicks: negativeHalf.flicks.toString(),
    futureVersionRejected: rejectsFuture,
  };
}
