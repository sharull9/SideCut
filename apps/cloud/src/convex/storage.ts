/// <reference types="node" />
"use node";

import process from "node:process";
import { createStorageEnv } from "@sidecut/env/cloud";

import {
  S3Client,
  CreateMultipartUploadCommand,
  AbortMultipartUploadCommand,
  UploadPartCommand,
  ListPartsCommand,
  CompleteMultipartUploadCommand,
  HeadObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import type { Part } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { v, ConvexError } from "convex/values";
import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { attachmentDisposition, safeFileName } from "./downloadName";

function storage() {
  let env;
  try {
    env = createStorageEnv(process.env);
  } catch {
    throw new ConvexError("Private media storage is not configured.");
  }
  const {
    R2_ACCOUNT_ID: account,
    R2_ACCESS_KEY_ID: accessKeyId,
    R2_SECRET_ACCESS_KEY: secretAccessKey,
    R2_BUCKET: bucket,
  } = env;
  return {
    bucket,
    client: new S3Client({
      region: "auto",
      endpoint: `https://${account}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    }),
  };
}

// Lists every stored part across pages, in the order the storage returns them.
async function listParts(
  client: S3Client,
  object: { Bucket: string; Key: string; UploadId: string },
) {
  const parts: Part[] = [];
  let marker: string | undefined;
  do {
    const page = await client.send(new ListPartsCommand({ ...object, PartNumberMarker: marker }));
    parts.push(...(page.Parts ?? []));
    marker = page.IsTruncated ? page.NextPartNumberMarker : undefined;
    if (page.IsTruncated && !marker) throw new ConvexError("Incomplete storage listing.");
  } while (marker);
  return parts;
}

async function abortMultipart(
  client: S3Client,
  bucket: string,
  objectKey: string,
  uploadId: string,
) {
  try {
    await client.send(
      new AbortMultipartUploadCommand({ Bucket: bucket, Key: objectKey, UploadId: uploadId }),
    );
  } catch (error) {
    // Already gone (completed, aborted, or expired): nothing left to clean up.
    if (error instanceof Error) {
      const status = (error as Error & { $metadata?: { httpStatusCode?: number } }).$metadata
        ?.httpStatusCode;
      if (error.name === "NoSuchUpload" || status === 404) return;
    }
    throw error;
  }
}

// Resolves null when the awaited Convex call reports that the version row is already gone.
async function orNull<T>(promise: Promise<T>): Promise<T | null> {
  try {
    return await promise;
  } catch (error) {
    if (error instanceof Error && error.message.includes("Upload unavailable.")) return null;
    throw error;
  }
}

async function abortUpload(objectKey: string, uploadId: string | null) {
  if (!uploadId) return;
  const { client, bucket } = storage();
  await abortMultipart(client, bucket, objectKey, uploadId);
}

const DAY_MS = 24 * 60 * 60 * 1000;

export const start = action({
  args: { versionId: v.id("mediaVersions") },
  handler: async (ctx, args): Promise<void> => {
    const { version } = await ctx.runQuery(internal.versions.transfer, args);
    if (version.status !== "uploading") throw new ConvexError("Upload unavailable.");
    if (version.uploadId) return;
    const { client, bucket } = storage();
    const created = await client.send(
      new CreateMultipartUploadCommand({
        Bucket: bucket,
        Key: version.objectKey,
        ContentType: "application/octet-stream",
      }),
    );
    if (!created.UploadId) throw new ConvexError("Storage did not create an upload.");
    try {
      const winner = await ctx.runMutation(internal.versions.attachUpload, {
        ...args,
        uploadId: created.UploadId,
      });
      if (winner === created.UploadId) return;
    } catch (error) {
      await client.send(
        new AbortMultipartUploadCommand({
          Bucket: bucket,
          Key: version.objectKey,
          UploadId: created.UploadId,
        }),
      );
      throw error;
    }
    await client.send(
      new AbortMultipartUploadCommand({
        Bucket: bucket,
        Key: version.objectKey,
        UploadId: created.UploadId,
      }),
    );
  },
});

export const partUrl = action({
  args: { versionId: v.id("mediaVersions"), part: v.number() },
  handler: async (ctx, args): Promise<{ url: string; expiresIn: number }> => {
    const { version } = await ctx.runQuery(internal.versions.transfer, {
      versionId: args.versionId,
    });
    if (
      version.status !== "uploading" ||
      !version.uploadId ||
      !Number.isInteger(args.part) ||
      args.part < 1 ||
      args.part > version.partCount
    )
      throw new ConvexError("Part unavailable.");
    const { client, bucket } = storage();
    const expiresIn = 60;
    const url = await getSignedUrl(
      client,
      new UploadPartCommand({
        Bucket: bucket,
        Key: version.objectKey,
        UploadId: version.uploadId,
        PartNumber: args.part,
      }),
      { expiresIn },
    );
    return { url, expiresIn };
  },
});

export const complete = action({
  args: { versionId: v.id("mediaVersions") },
  handler: async (ctx, args): Promise<void> => {
    const { version } = await ctx.runQuery(internal.versions.transfer, args);
    if (version.status === "processing" || version.status === "ready") return;
    if (version.status !== "uploading" || !version.uploadId)
      throw new ConvexError("Upload unavailable.");
    if (version.open) throw new ConvexError("Recording upload is not sealed.");
    const { client, bucket } = storage();
    const object = { Bucket: bucket, Key: version.objectKey };
    // Reconcile a completed object after a lost response or database outage.
    let exists = false;
    try {
      const head = await client.send(new HeadObjectCommand(object));
      if (head.ContentLength !== version.expectedBytes)
        throw new ConvexError("Stored size does not match version.");
      exists = true;
    } catch (error) {
      if (!(error instanceof Error) || error.name !== "NotFound") throw error;
    }
    if (!exists) {
      const parts = (await listParts(client, { ...object, UploadId: version.uploadId })).map(
        (part) => {
          if (!part.PartNumber || !part.ETag || !part.Size)
            throw new ConvexError("Invalid stored part.");
          return { PartNumber: part.PartNumber, ETag: part.ETag, Size: part.Size };
        },
      );
      parts.sort((a, b) => a.PartNumber - b.PartNumber);
      if (
        parts.length !== version.partCount ||
        parts.some((p, i) => p.PartNumber !== i + 1) ||
        parts.reduce((sum, p) => sum + p.Size, 0) !== version.expectedBytes
      )
        throw new ConvexError("Upload incomplete.");
      for (const part of parts)
        await ctx.runMutation(internal.versions.recordPart, {
          ...args,
          part: part.PartNumber,
          etag: part.ETag,
          bytes: part.Size,
        });
      await client.send(
        new CompleteMultipartUploadCommand({
          ...object,
          UploadId: version.uploadId,
          MultipartUpload: { Parts: parts.map(({ PartNumber, ETag }) => ({ PartNumber, ETag })) },
        }),
      );
      const head = await client.send(new HeadObjectCommand(object));
      if (head.ContentLength !== version.expectedBytes)
        throw new ConvexError("Stored size does not match version.");
    }
    // Recheck current authority after the external operations.
    await ctx.runQuery(internal.versions.transfer, args);
    await ctx.runMutation(internal.versions.uploaded, args);
  },
});

export const playbackUrl = action({
  args: { mediaId: v.id("media"), versionId: v.optional(v.id("mediaVersions")) },
  handler: async (ctx, args): Promise<{ url: string; expiresIn: number }> => {
    const media = await ctx.runQuery(internal.versions.playback, args);
    const { client, bucket } = storage();
    const expiresIn = 60;
    return {
      url: await getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: bucket,
          Key: media.key,
          ResponseContentType: "video/mp4",
          ResponseContentDisposition: "inline",
        }),
        { expiresIn },
      ),
      expiresIn,
    };
  },
});

export const sourceUrl = action({
  args: { mediaId: v.id("media") },
  handler: async (
    ctx,
    args,
  ): Promise<{
    url: string;
    expiresIn: number;
    name: string;
    snapshot: string;
    marks: { seconds: number; name: string }[];
  }> => {
    const source = await ctx.runQuery(internal.versions.source, args);
    const { client, bucket } = storage();
    const expiresIn = 60;
    return {
      url: await getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: source.key }), {
        expiresIn,
      }),
      expiresIn,
      name: source.name,
      snapshot: source.snapshot,
      marks: source.marks,
    };
  },
});

export const guestUrl = action({
  args: { sessionToken: v.string(), download: v.boolean() },
  handler: async (ctx, args): Promise<{ url: string; expiresIn: number }> => {
    const delivery = await ctx.runQuery(internal.shares.delivery, args);
    const { client, bucket } = storage();
    const url = await getSignedUrl(
      client,
      new GetObjectCommand({
        Bucket: bucket,
        Key: delivery.key,
        ResponseContentDisposition: args.download ? "attachment" : "inline",
        ...(args.download ? {} : { ResponseContentType: "video/mp4" }),
      }),
      { expiresIn: delivery.expiresIn },
    );
    // Do not return a new grant if revocation happened while signing.
    await ctx.runQuery(internal.shares.delivery, args);
    return { url, expiresIn: delivery.expiresIn };
  },
});

export const uploadedParts = action({
  args: { versionId: v.id("mediaVersions") },
  handler: async (ctx, args): Promise<{ parts: number[] }> => {
    const { version } = await ctx.runQuery(internal.versions.transfer, args);
    if (version.status !== "uploading") throw new ConvexError("Upload unavailable.");
    if (!version.uploadId) return { parts: [] };
    const { client, bucket } = storage();
    const parts = await listParts(client, {
      Bucket: bucket,
      Key: version.objectKey,
      UploadId: version.uploadId,
    });
    return {
      parts: parts
        .map((part) => part.PartNumber)
        .filter((n): n is number => n !== undefined)
        .sort((a, b) => a - b),
    };
  },
});

export const abort = action({
  args: { versionId: v.id("mediaVersions") },
  handler: async (ctx, args): Promise<{ cancelled: boolean }> => {
    const auth = await orNull(ctx.runQuery(internal.versions.authorizeCancel, args));
    if (auth?.status !== "uploading") return { cancelled: false };
    // Abort the multipart first: once it is gone no part can be uploaded, and a failure
    // here leaves the row still uploading so a retry or the sweeper can finish the job.
    await abortUpload(auth.objectKey, auth.uploadId);
    const released = await orNull(
      ctx.runMutation(internal.versions.cancelUpload, {
        versionId: args.versionId,
        reason: "cancelled",
      }),
    );
    return { cancelled: released?.cancelled === true };
  },
});

export const originalUrl = action({
  args: { mediaId: v.id("media"), versionId: v.optional(v.id("mediaVersions")) },
  handler: async (ctx, args): Promise<{ url: string; fileName: string; expiresIn: number }> => {
    const original = await ctx.runQuery(internal.versions.original, args);
    const { client, bucket } = storage();
    const expiresIn = 300;
    const fileName = safeFileName(original.fileName ?? `${original.mediaName}-v${original.number}`);
    const url = await getSignedUrl(
      client,
      new GetObjectCommand({
        Bucket: bucket,
        Key: original.objectKey,
        ResponseContentDisposition: attachmentDisposition(fileName),
      }),
      { expiresIn },
    );
    return { url, fileName, expiresIn };
  },
});

export const abortStaleUploads = internalAction({
  args: {},
  handler: async (ctx): Promise<number> => {
    const stale = await ctx.runQuery(internal.versions.staleUploads, {
      olderThan: Date.now() - DAY_MS,
      limit: 20,
    });
    let count = 0;
    for (const row of stale) {
      try {
        // A row whose storage cannot be reached stays uploading and is retried on the next run.
        await abortUpload(row.objectKey, row.uploadId);
        const released = await orNull(
          ctx.runMutation(internal.versions.cancelUpload, { versionId: row._id, reason: "stale" }),
        );
        if (released?.cancelled) count++;
      } catch (error) {
        console.error("Stale upload cleanup failed", row._id, error);
      }
    }
    // A full batch that made progress may have more behind it; keep draining without a tight
    // loop on rows that keep failing (those wait for the next hourly run).
    if (stale.length === 20 && count > 0)
      await ctx.scheduler.runAfter(0, internal.storage.abortStaleUploads, {});
    return count;
  },
});
