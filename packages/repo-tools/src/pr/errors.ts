import { Data } from "effect";

export class PrInputInvalid extends Data.TaggedError("PrInputInvalid")<{
  readonly message: string;
}> {}

export class PrFileFailure extends Data.TaggedError("PrFileFailure")<{
  readonly operation: "inspect" | "read" | "create-directory" | "write";
  readonly path: string;
  readonly cause: unknown;
}> {}

export class PrGitFailure extends Data.TaggedError("PrGitFailure")<{
  readonly args: readonly string[];
  readonly cause: unknown;
}> {}

export class PrGitHubFailure extends Data.TaggedError("PrGitHubFailure")<{
  readonly operation: "view" | "edit" | "create" | "decode-view" | "decode-create";
  readonly cause: unknown;
  readonly pr?: number;
}> {}

export class PrDraftInvalid extends Data.TaggedError("PrDraftInvalid")<{
  readonly source: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class PrBodyCheckFailed extends Data.TaggedError("PrBodyCheckFailed")<{
  readonly findings: readonly string[];
  readonly report: string;
}> {}

export class PrRemoteHeadMismatch extends Data.TaggedError("PrRemoteHeadMismatch")<{
  readonly action: "apply";
  readonly localHead: string;
  readonly remoteHead: string;
}> {}

export class PrMutationRejected extends Data.TaggedError("PrMutationRejected")<{
  readonly action: "apply" | "create";
  readonly message: string;
}> {}

export class PrInternalFailure extends Data.TaggedError("PrInternalFailure")<{
  readonly operation: string;
  readonly cause: unknown;
}> {}

export type PrBodyError =
  | PrInputInvalid
  | PrFileFailure
  | PrGitFailure
  | PrGitHubFailure
  | PrDraftInvalid
  | PrBodyCheckFailed
  | PrRemoteHeadMismatch
  | PrMutationRejected
  | PrInternalFailure;
