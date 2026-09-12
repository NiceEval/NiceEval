import { Data } from "effect";

export class UseCaseInputInvalid extends Data.TaggedError("UseCaseInputInvalid")<{
  readonly source: "slug" | "parent" | "title" | "body";
  readonly message: string;
}> {}

export class UseCaseParentMissing extends Data.TaggedError("UseCaseParentMissing")<{
  readonly parent: string;
  readonly nextStep: string;
}> {}

export class UseCaseIndexInvalid extends Data.TaggedError("UseCaseIndexInvalid")<{
  readonly path: string;
  readonly message: string;
}> {}

export class UseCaseTargetConflict extends Data.TaggedError("UseCaseTargetConflict")<{
  readonly path: string;
  readonly message: string;
}> {}

export class UseCaseIoError extends Data.TaggedError("UseCaseIoError")<{
  readonly operation: "inspect" | "read";
  readonly path: string;
  readonly message: string;
}> {}

export type UseCaseDomainError =
  | UseCaseInputInvalid
  | UseCaseParentMissing
  | UseCaseIndexInvalid
  | UseCaseTargetConflict
  | UseCaseIoError;

export function isUseCaseDomainError(value: unknown): value is UseCaseDomainError {
  return value instanceof UseCaseInputInvalid ||
    value instanceof UseCaseParentMissing ||
    value instanceof UseCaseIndexInvalid ||
    value instanceof UseCaseTargetConflict ||
    value instanceof UseCaseIoError;
}

export function useCaseErrorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
