import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Releases abandoned uploads (and their multipart storage) in batches of 20 per run.
crons.interval("abort stale uploads", { hours: 1 }, internal.storage.abortStaleUploads, {});

export default crons;
