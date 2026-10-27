import type { NativeFileReference } from "./native-recording.ts";

export type NativeDeliveryRequest = {
  codec: "h264" | "hevc";
  videoBitrate: number;
  audioBitrate: number;
  name: string;
};
export type NativeDeliveryResult = NativeFileReference;
