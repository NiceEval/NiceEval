import { Data } from "effect";

export class IssueInputError extends Data.TaggedError("IssueInputError")<{ readonly message: string }> {}
export class IssueRemoteError extends Data.TaggedError("IssueRemoteError")<{
  readonly operation: string;
  readonly message: string;
  readonly uncertain: boolean;
}> {}
export class IssuePlanExpired extends Data.TaggedError("IssuePlanExpired")<{ readonly receiptId: string }> {}
export class IssuePlanConsumed extends Data.TaggedError("IssuePlanConsumed")<{ readonly receiptId: string }> {}
export class IssuePlanNotPlanned extends Data.TaggedError("IssuePlanNotPlanned")<{ readonly receiptId: string }> {}
export class IssuePlanCorrupt extends Data.TaggedError("IssuePlanCorrupt")<{ readonly receiptId: string; readonly message: string }> {}
export class IssuePlanIoError extends Data.TaggedError("IssuePlanIoError")<{
  readonly operation: "plan" | "consume";
  readonly path: string;
  readonly message: string;
}> {}
export class IssuePlanDrifted extends Data.TaggedError("IssuePlanDrifted")<{
  readonly receiptId: string;
  readonly expected: string;
  readonly actual: string;
}> {}
export class IssueCreateConflict extends Data.TaggedError("IssueCreateConflict")<{ readonly message: string }> {}
export type IssueError = IssueInputError | IssueRemoteError | IssuePlanExpired | IssuePlanConsumed | IssuePlanNotPlanned | IssuePlanCorrupt | IssuePlanIoError | IssuePlanDrifted | IssueCreateConflict;
