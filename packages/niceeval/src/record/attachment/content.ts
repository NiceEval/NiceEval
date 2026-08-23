import { Stream } from "effect";

import { makeRecordBlobSource } from "./runtime.ts";
import type { RecordBlobSource } from "./types.ts";

/** Capture-only content capability; it is consumed when an Attachment is prepared. */
export type RecordContentSource<E = never, R = never> = RecordBlobSource<E, R>;

export const RecordContent = Object.freeze({
  bytes(bytes: Uint8Array): RecordContentSource {
    return makeRecordBlobSource(Stream.succeed(new Uint8Array(bytes)));
  },
  text(text: string): RecordContentSource {
    return makeRecordBlobSource(Stream.succeed(new TextEncoder().encode(text)));
  },
  stream<E, R>(stream: Stream.Stream<Uint8Array, E, R>): RecordContentSource<E, R> {
    return makeRecordBlobSource(stream);
  },
});
