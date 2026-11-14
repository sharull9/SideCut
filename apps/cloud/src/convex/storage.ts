/// <reference types="node" />
"use node";

import process from "node:process";

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
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { v, ConvexError } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";

function storage() {
  const account = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET;
  if (!account || !/^[a-f0-9]{32}$/.test(account) || !accessKeyId || !secretAccessKey || !bucket)
    throw new ConvexError("Private media storage is not configured.");
  return {
    bucket,
    client: new S3Client({
      region: "auto",
      endpoint: `https://${account}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    }),
  };
}

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
      const parts: { PartNumber: number; ETag: string; Size: number }[] = [];
      let marker: string | undefined;
      do {
        const page = await client.send(
          new ListPartsCommand({ ...object, UploadId: version.uploadId, PartNumberMarker: marker }),
        );
        for (const part of page.Parts ?? []) {
          if (!part.PartNumber || !part.ETag || !part.Size)
            throw new ConvexError("Invalid stored part.");
          parts.push({ PartNumber: part.PartNumber, ETag: part.ETag, Size: part.Size });
        }
        marker = page.IsTruncated ? page.NextPartNumberMarker : undefined;
        if (page.IsTruncated && !marker) throw new ConvexError("Incomplete storage listing.");
      } while (marker);
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
