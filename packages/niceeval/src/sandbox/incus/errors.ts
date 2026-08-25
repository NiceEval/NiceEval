import { Data } from "effect";

export type IncusPlanningCode =
  | "incus-unreachable"
  | "incus-undeployed"
  | "incus-descriptor-invalid"
  | "incus-domain-mismatch"
  | "sandbox-artifact-unverified"
  | "sandbox-capacity-unavailable"
  | "sandbox-capability-unsatisfied";

export type IncusRuntimeCode =
  | IncusPlanningCode
  | "sandbox-readiness-failed"
  | "sandbox-allocation-lost"
  | "sandbox-destroy-incomplete";

export class IncusProviderError extends Data.TaggedError("IncusProviderError")<{
  readonly code: IncusRuntimeCode;
  readonly summary: string;
  readonly actions: readonly string[];
  readonly cause?: unknown;
}> {
  get message(): string {
    return this.summary;
  }
}

export function incusError(
  code: IncusRuntimeCode,
  summary: string,
  actions: readonly string[],
  cause?: unknown,
): IncusProviderError {
  return new IncusProviderError({
    code,
    summary,
    actions: Object.freeze([...actions]),
    ...(cause === undefined ? {} : { cause }),
  });
}

export function isIncusProviderError(error: unknown): error is IncusProviderError {
  return error instanceof IncusProviderError;
}
