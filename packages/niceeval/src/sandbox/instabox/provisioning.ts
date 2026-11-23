// @concord-file
// @concord-implements docs/feature/sandbox/architecture/providers/instabox.md#provisioning-对账与重试
import { Effect } from "effect";
import { providerBoundaryEffect } from "../backend.ts";
import {
  classifyProvisionErrorFallback,
  classifySandboxIoError,
  isRejectedProvisionError,
  type SandboxProvisionErrorKind,
} from "../errors.ts";
import { withSandboxIoRetry } from "../io-retry.ts";
import { InstaboxApiError, InstaboxProtocolError } from "./api.ts";

function provisionKind(error: unknown): SandboxProvisionErrorKind {
  if (error instanceof InstaboxApiError) {
    if (error.status === 429) return "rate_limit";
    return error.status >= 500 ? "ambiguous" : "unknown";
  }
  if (error instanceof InstaboxProtocolError) return "unknown";
  // Node fetch wraps connect failures and lost responses in the same TypeError.
  if (error instanceof TypeError && error.message === "fetch failed") {
    const cause = classifyProvisionErrorFallback(error.cause);
    if (cause === "rejected") return cause;
  }
  const kind = classifyProvisionErrorFallback(error);
  return kind === "unknown" && classifySandboxIoError(error) !== "unknown" ? "ambiguous" : kind;
}

export class InstaboxPreparationError extends Error {
  readonly kind: SandboxProvisionErrorKind;
  constructor(operation: string, cause: unknown) {
    super(`Instabox ${operation} failed: ${cause instanceof Error ? cause.message : "unknown error"}`, { cause });
    this.kind = provisionKind(cause);
  }
}

export function preparationRequest<T>(
  operation: "snapshot lookup" | "startup wait" | "machine readiness check" | "SSH grant",
  run: (signal: AbortSignal) => Promise<T>,
) {
  return withSandboxIoRetry(providerBoundaryEffect(run), {
    classify(error) {
      if (operation === "SSH grant") return isRejectedProvisionError(provisionKind(error)) ? "network" : "unknown";
      return classifySandboxIoError(error instanceof InstaboxApiError ? { status: error.status } : error);
    },
  }).pipe(Effect.mapError((cause) => new InstaboxPreparationError(operation, cause)));
}
