import { Data } from "effect";
import { normalizeExternalCause, type ExternalCause } from "../../shared/external-cause.ts";

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
  readonly cause: ExternalCause | undefined;
  readonly reason: "storage-bytes" | undefined;
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
    actions,
    cause: cause === undefined ? undefined : normalizeExternalCause(cause),
    reason: undefined,
  });
}

export function isIncusProviderError(error: unknown): error is IncusProviderError {
  return error instanceof IncusProviderError;
}
