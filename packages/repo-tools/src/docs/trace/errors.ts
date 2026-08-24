import { Data } from "effect";

export class TraceIoError extends Data.TaggedError("TraceIoError")<{
  readonly operation: "read" | "scan";
  readonly path: string;
  readonly message: string;
}> {}

export class TraceFormatError extends Data.TaggedError("TraceFormatError")<{
  readonly path: string;
  readonly subject: string;
  readonly message: string;
}> {}

export class TraceSelectorMissing extends Data.TaggedError("TraceSelectorMissing")<{
  readonly selector: string;
  readonly subject: "feature" | "test";
}> {}

export class TraceSelectorAmbiguous extends Data.TaggedError("TraceSelectorAmbiguous")<{
  readonly selector: string;
  readonly candidates: readonly string[];
}> {}

export type TraceError = TraceIoError | TraceFormatError | TraceSelectorMissing | TraceSelectorAmbiguous;

export function isTraceError(value: unknown): value is TraceError {
  return value instanceof TraceIoError ||
    value instanceof TraceFormatError ||
    value instanceof TraceSelectorMissing ||
    value instanceof TraceSelectorAmbiguous;
}
