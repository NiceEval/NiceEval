import { Data } from "effect";

export class CaseRelationsFormatError extends Data.TaggedError("CaseRelationsFormatError")<{
  readonly path: string;
  readonly message: string;
}> {}

export class InvalidCaseToken extends Data.TaggedError("InvalidCaseToken")<{ readonly selector: string }> {}
export class CaseNotCurrent extends Data.TaggedError("CaseNotCurrent")<{ readonly selector: string }> {}
export class CaseAlreadyCurrent extends Data.TaggedError("CaseAlreadyCurrent")<{
  readonly selector: string;
}> {}
export class CasePathStale extends Data.TaggedError("CasePathStale")<{
  readonly selector: string;
  readonly currentSelector: string;
}> {}
export class RelationAlreadyCurrent extends Data.TaggedError("RelationAlreadyCurrent")<{
  readonly selector: string;
  readonly relation: "regression" | "issue";
  readonly value: string;
}> {}
export class RelationNotCurrent extends Data.TaggedError("RelationNotCurrent")<{
  readonly selector: string;
  readonly relation: "regression" | "issue";
  readonly value: string;
}> {}

export type CaseRelationsError = CaseRelationsFormatError | InvalidCaseToken | CaseNotCurrent | CaseAlreadyCurrent |
  CasePathStale | RelationAlreadyCurrent | RelationNotCurrent;
