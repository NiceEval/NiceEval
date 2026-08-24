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

export class TraceSnapshotChanged extends Data.TaggedError("TraceSnapshotChanged")<{
  readonly path: string;
  readonly before: number;
  readonly after: number;
  readonly attempts: number;
}> {}

export class TraceMutationActive extends Data.TaggedError("TraceMutationActive")<{
  readonly path: string;
  readonly attempts: number;
}> {}

export class TraceInputChanged extends Data.TaggedError("TraceInputChanged")<{
  readonly path: string;
  readonly attempts: number;
  readonly changed: readonly string[];
}> {}

export class TraceRecoveryRequired extends Data.TaggedError("TraceRecoveryRequired")<{
  readonly path: string;
  readonly nextStep: "pnpm trace recover";
}> {}

export class TraceRecoveryConflict extends Data.TaggedError("TraceRecoveryConflict")<{
  readonly path: string;
  readonly message: string;
}> {}

export type TraceError = TraceIoError | TraceFormatError | TraceSelectorMissing | TraceSelectorAmbiguous |
  TraceSnapshotChanged | TraceMutationActive | TraceInputChanged | TraceRecoveryRequired | TraceRecoveryConflict;

export function isTraceError(value: unknown): value is TraceError {
  return value instanceof TraceIoError ||
    value instanceof TraceFormatError ||
    value instanceof TraceSelectorMissing ||
    value instanceof TraceSelectorAmbiguous ||
    value instanceof TraceSnapshotChanged ||
    value instanceof TraceMutationActive ||
    value instanceof TraceInputChanged ||
    value instanceof TraceRecoveryRequired ||
    value instanceof TraceRecoveryConflict;
}
