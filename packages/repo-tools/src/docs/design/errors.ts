import { Data } from "effect";

export class DesignInputInvalid extends Data.TaggedError("DesignInputInvalid")<{
  readonly source: string;
  readonly message: string;
}> {}

export class DesignIoError extends Data.TaggedError("DesignIoError")<{
  readonly operation: string;
  readonly path: string;
  readonly message: string;
}> {}

export class DesignManifestInvalid extends Data.TaggedError("DesignManifestInvalid")<{
  readonly path: string;
  readonly message: string;
}> {}

export class DesignSelectorMissing extends Data.TaggedError("DesignSelectorMissing")<{
  readonly selector: string;
  readonly subject: "design" | "plan";
  readonly nextStep: string;
}> {}

export class DesignSelectorAmbiguous extends Data.TaggedError("DesignSelectorAmbiguous")<{
  readonly selector: string;
  readonly subject: "design" | "plan";
  readonly candidates: readonly string[];
}> {}

export class DesignConflict extends Data.TaggedError("DesignConflict")<{
  readonly operation: "create" | "decide";
  readonly path: string;
  readonly message: string;
}> {}

export class DesignAlreadyDecided extends Data.TaggedError("DesignAlreadyDecided")<{
  readonly design: string;
  readonly selectedPlan: string;
  readonly requestedPlan: string;
  readonly message: string;
}> {}

export class DesignDecisionIncomplete extends Data.TaggedError("DesignDecisionIncomplete")<{
  readonly design: string;
  readonly plan: string;
  readonly findings: readonly string[];
  readonly nextStep: string;
}> {}

export type DesignDomainError =
  | DesignInputInvalid
  | DesignIoError
  | DesignManifestInvalid
  | DesignSelectorMissing
  | DesignSelectorAmbiguous
  | DesignConflict
  | DesignAlreadyDecided
  | DesignDecisionIncomplete;

export function isDesignDomainError(value: unknown): value is DesignDomainError {
  return value instanceof DesignInputInvalid ||
    value instanceof DesignIoError ||
    value instanceof DesignManifestInvalid ||
    value instanceof DesignSelectorMissing ||
    value instanceof DesignSelectorAmbiguous ||
    value instanceof DesignConflict ||
    value instanceof DesignAlreadyDecided ||
    value instanceof DesignDecisionIncomplete;
}

export function designErrorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
