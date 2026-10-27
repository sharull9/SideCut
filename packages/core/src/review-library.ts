/// <reference lib="dom" />
import { decodeProjectFile, encodeProjectFile } from "@sidecut/contracts/project";
import {
  decodeReviewThread,
  decodeReviewVersion,
  type ReviewThread,
  type ReviewVersion,
} from "@sidecut/contracts/review";
import type { StorageRequest, StorageRow } from "@sidecut/contracts/storage";

export interface ReviewStorage {
  request: (request: StorageRequest) => readonly StorageRow[] | Promise<readonly StorageRow[]>;
  putFile: (bytes: Uint8Array) => Promise<string>;
  getFile: (id: string) => Promise<Uint8Array>;
  removeFile: (id: string) => Promise<void>;
  putBlob?: (blob: Blob) => Promise<string>;
  getBlob?: (id: string) => Promise<Blob>;
}
const fallbackLimit = 128 * 1024 * 1024;
const artifactLimit = 1024 ** 4;
const snapshotLimit = 32 * 1024 * 1024;
const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();

export class ReviewStore {
  constructor(private readonly storage: ReviewStorage) {}
  private async row(collection: "reviewVersions" | "reviewThreads", key: string) {
    const row = (await this.storage.request({ type: "read", collection, key }))[0];
    if (!row) throw new Error("Review document not found.");
    return row.value;
  }
  private version(value: string, key: string) {
    const version = decodeReviewVersion(JSON.parse(value));
    if (
      version.id !== key ||
      !version.artifact.bytes ||
      version.artifact.bytes > artifactLimit ||
      version.source.snapshotJSON.length > snapshotLimit
    )
      throw new Error("Invalid review version metadata.");
    const snapshot = decodeProjectFile(JSON.parse(version.source.snapshotJSON));
    if (snapshot.project.id !== version.projectID || snapshot.revision !== version.sourceRevision)
      throw new Error("Review snapshot does not match its metadata.");
    return version;
  }
  private thread(value: string, key: string) {
    const thread = decodeReviewThread(JSON.parse(value));
    if (thread.id !== key || (thread.resolvedAt === null) !== (thread.resolvedBy === null))
      throw new Error("Invalid review thread metadata.");
    return thread;
  }
  private async getVersion(versionID: string) {
    return this.version(await this.row("reviewVersions", versionID), versionID);
  }
  async listVersions(projectID: string): Promise<ReviewVersion[]> {
    return (await this.storage.request({ type: "read", collection: "reviewVersions" }))
      .map((row) => this.version(row.value, row.key))
      .filter((v) => v.projectID === projectID)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async publish(
    input: {
      snapshotJSON: string;
      startSeconds: number;
      durationSeconds: number;
      createdBy: string;
      title: string;
    },
    artifact: Blob,
    name: string,
  ): Promise<ReviewVersion> {
    if (input.snapshotJSON.length > snapshotLimit) throw new Error("Review snapshot is too large.");
    const snapshot = decodeProjectFile(JSON.parse(input.snapshotJSON));
    const snapshotJSON = encodeProjectFile(snapshot);
    if (
      snapshotJSON.length > snapshotLimit ||
      !Number.isFinite(input.startSeconds + input.durationSeconds)
    )
      throw new Error("Review source range or snapshot is invalid.");
    if (!artifact.size || artifact.size > artifactLimit)
      throw new Error("Review artifact size is invalid.");
    const type = artifact.type;
    if (type !== "video/webm" && type !== "video/mp4" && type !== "audio/wav")
      throw new Error("Unsupported review artifact type.");
    const versionID = id();
    // Validate all metadata before storing the file.
    const metadata = {
      id: versionID,
      projectID: snapshot.project.id,
      sourceRevision: snapshot.revision,
      createdAt: now(),
      createdBy: input.createdBy,
      title: input.title,
      source: {
        startSeconds: input.startSeconds,
        durationSeconds: input.durationSeconds,
        snapshotJSON,
      },
      artifact: { fileID: versionID, name, type, bytes: artifact.size },
    };
    decodeReviewVersion(metadata);
    if (!this.storage.putBlob && artifact.size > fallbackLimit)
      throw new Error("This storage cannot save review artifacts larger than 128 MiB.");
    const fileID = this.storage.putBlob
      ? await this.storage.putBlob(artifact.slice(0, artifact.size, artifact.type))
      : await this.storage.putFile(new Uint8Array(await artifact.arrayBuffer()));
    try {
      const version = decodeReviewVersion({
        ...metadata,
        artifact: { ...metadata.artifact, fileID },
      });
      await this.storage.request({
        type: "commit",
        checks: [{ collection: "reviewVersions", key: version.id, value: null }],
        writes: [{ collection: "reviewVersions", key: version.id, value: JSON.stringify(version) }],
      });
      return version;
    } catch (error) {
      await this.storage.removeFile(fileID).catch(() => {});
      throw error;
    }
  }
  async artifact(versionID: string): Promise<Blob> {
    const version = await this.getVersion(versionID);
    if (!this.storage.getBlob && version.artifact.bytes > fallbackLimit)
      throw new Error("This storage cannot read review artifacts larger than 128 MiB.");
    const blob = this.storage.getBlob
      ? await this.storage.getBlob(version.artifact.fileID)
      : new Blob([new Uint8Array(await this.storage.getFile(version.artifact.fileID))]);
    if (blob.size !== version.artifact.bytes)
      throw new Error("Review artifact is missing or truncated.");
    return blob.slice(0, blob.size, version.artifact.type);
  }
  async listThreads(versionID: string): Promise<ReviewThread[]> {
    await this.getVersion(versionID);
    return (await this.storage.request({ type: "read", collection: "reviewThreads" }))
      .map((row) => this.thread(row.value, row.key))
      .filter((t) => t.versionID === versionID)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  async createThread(input: {
    versionID: string;
    versionStartSeconds: number;
    durationSeconds: number;
    author: string;
    body: string;
  }): Promise<ReviewThread> {
    const version = await this.getVersion(input.versionID);
    const end = input.versionStartSeconds + input.durationSeconds;
    if (
      !Number.isFinite(end) ||
      end > version.source.durationSeconds ||
      input.versionStartSeconds >= version.source.durationSeconds
    )
      throw new Error("Thread anchor is outside the review version.");
    const thread = decodeReviewThread({
      id: id(),
      versionID: version.id,
      anchor: {
        versionStartSeconds: input.versionStartSeconds,
        durationSeconds: input.durationSeconds,
        sourceStartSeconds: version.source.startSeconds + input.versionStartSeconds,
      },
      author: input.author,
      body: input.body,
      createdAt: now(),
      replies: [],
      resolvedAt: null,
      resolvedBy: null,
      revision: 0,
    });
    await this.storage.request({
      type: "commit",
      checks: [{ collection: "reviewThreads", key: thread.id, value: null }],
      writes: [{ collection: "reviewThreads", key: thread.id, value: JSON.stringify(thread) }],
    });
    return thread;
  }
  private async change(
    threadID: string,
    expectedRevision: number,
    update: (thread: ReviewThread) => ReviewThread,
  ) {
    const value = await this.row("reviewThreads", threadID);
    const thread = this.thread(value, threadID);
    await this.getVersion(thread.versionID);
    if (thread.revision !== expectedRevision)
      throw new Error("Save conflict: review thread changed.");
    const next = decodeReviewThread({ ...update(thread), revision: thread.revision + 1 });
    await this.storage.request({
      type: "commit",
      checks: [{ collection: "reviewThreads", key: threadID, value }],
      writes: [{ collection: "reviewThreads", key: threadID, value: JSON.stringify(next) }],
    });
    return next;
  }
  async reply(
    threadID: string,
    expectedRevision: number,
    input: { author: string; body: string },
  ): Promise<ReviewThread> {
    return this.change(threadID, expectedRevision, (thread) => ({
      ...thread,
      replies: [...thread.replies, { id: id(), ...input, createdAt: now() }],
    }));
  }
  async resolve(
    threadID: string,
    expectedRevision: number,
    input: { author: string; resolved: boolean },
  ): Promise<ReviewThread> {
    if (!input.author.trim() || typeof input.resolved !== "boolean")
      throw new Error("Invalid resolution author or state.");
    return this.change(threadID, expectedRevision, (thread) => ({
      ...thread,
      resolvedAt: input.resolved ? now() : null,
      resolvedBy: input.resolved ? input.author : null,
    }));
  }
}
