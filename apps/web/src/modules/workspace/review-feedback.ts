import { decodeProjectFile, encodeProjectFile, type ProjectFile } from "@sidecut/contracts/project";
import type { ReviewThread, ReviewVersion } from "@sidecut/contracts/review";

export function reviewMarker(version: ReviewVersion, thread: ReviewThread, current: ProjectFile) {
  const frozen = decodeProjectFile(JSON.parse(version.source.snapshotJSON));
  if (
    current.project.id !== version.projectID ||
    frozen.project.id !== version.projectID ||
    thread.versionID !== version.id
  )
    throw new Error("This feedback belongs to a different project or version.");
  if (
    current.revision !== version.sourceRevision ||
    frozen.revision !== version.sourceRevision ||
    encodeProjectFile({ revision: current.revision, project: current.project }) !==
      encodeProjectFile({ revision: frozen.revision, project: frozen.project })
  )
    throw new Error("The project has changed since this review version was exported.");
  const { versionStartSeconds, durationSeconds, sourceStartSeconds } = thread.anchor;
  const mapped = version.source.startSeconds + versionStartSeconds;
  if (
    !Number.isFinite(mapped + durationSeconds + sourceStartSeconds) ||
    versionStartSeconds < 0 ||
    durationSeconds < 0 ||
    versionStartSeconds >= version.source.durationSeconds ||
    versionStartSeconds + durationSeconds > version.source.durationSeconds ||
    Math.abs(sourceStartSeconds - mapped) > 1e-9
  )
    throw new Error("The feedback time mapping is invalid.");
  return {
    label: "Create marker from review feedback",
    expectedRevision: current.revision,
    commands: [
      {
        addMarker: {
          marker: {
            time: mapped,
            duration: durationSeconds,
            name: thread.body,
            kind: "comment",
            note: `Review: ${version.title} · ${thread.author} · ${thread.id}`,
          },
        },
      },
    ],
  };
}

function csvCell(value: string | number | null) {
  let text = String(value ?? "");
  let start = 0;
  while (start < text.length && (text.charCodeAt(start) <= 32 || /\s/u.test(text[start] ?? "")))
    start++;
  if ("=+-@".includes(text[start] ?? "\0") || [9, 10, 13].includes(text.charCodeAt(0)))
    text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function reviewFeedbackCSV(version: ReviewVersion, threads: readonly ReviewThread[]) {
  const rows: (string | number | null)[][] = [
    [
      "project_id",
      "version_id",
      "version_title",
      "version_created_at",
      "version_created_by",
      "source_revision",
      "render_start_seconds",
      "render_duration_seconds",
      "version_start_seconds",
      "source_start_seconds",
      "duration_seconds",
      "thread_id",
      "status",
      "resolved_at",
      "resolved_by",
      "entry_type",
      "entry_id",
      "author",
      "created_at",
      "body",
    ],
  ];
  for (const thread of threads) {
    const common = [
      version.projectID,
      version.id,
      version.title,
      version.createdAt,
      version.createdBy,
      version.sourceRevision,
      version.source.startSeconds,
      version.source.durationSeconds,
      thread.anchor.versionStartSeconds,
      thread.anchor.sourceStartSeconds,
      thread.anchor.durationSeconds,
      thread.id,
      thread.resolvedAt ? "resolved" : "open",
      thread.resolvedAt,
      thread.resolvedBy,
    ];
    rows.push([...common, "thread", thread.id, thread.author, thread.createdAt, thread.body]);
    for (const reply of thread.replies)
      rows.push([...common, "reply", reply.id, reply.author, reply.createdAt, reply.body]);
  }
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
