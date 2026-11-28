// @concord-file
// @concord-implements docs/feature/sandbox/architecture/providers/instabox.md#provisioning-对账与重试
import { Effect } from "effect";
import { boundedErrorText } from "../../shared/bounded-error-text.ts";
import { providerBoundaryEffect } from "../backend.ts";
import {
  classifyProvisionErrorFallback,
  classifySandboxIoError,
  isRejectedProvisionError,
  isRetryableSandboxIoError,
  type SandboxProvisionErrorKind,
} from "../errors.ts";
import { withSandboxIoRetry } from "../io-retry.ts";
import { InstaboxApiError, InstaboxProtocolError, type InstaboxErrorDetail } from "./api.ts";

export const INSTABOX_MACHINE_DELETE_TIMEOUT_MS = 180_000;
export const INSTABOX_PROVISION_RETRY_DELAY_LIMIT_MS = 60_000;

export function instaboxRetryDelayMs(detail: InstaboxErrorDetail): number {
  return (detail.retryDelaySeconds ?? detail.retryAfterSeconds ?? 0) * 1000;
}

export function serviceRetryKind(detail: InstaboxErrorDetail): SandboxProvisionErrorKind {
  if (detail.retryable === false) return "unknown";
  switch (detail.code) {
    case "quota_exceeded":
    case "spec_not_allowed":
    case "permission_denied":
      return "unknown";
    case "rate_limited":
      return "rate_limit";
    case "no_capacity":
    case "host_unavailable":
      return "ambiguous";
    default:
      return detail.retryable === true ? "ambiguous" : "unknown";
  }
}

export function provisionKind(error: unknown): SandboxProvisionErrorKind {
  if (error instanceof InstaboxApiError) {
    if (error.detail.retryable === false || error.code === "quota_exceeded") return "unknown";
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

type PreparationPhase = "snapshot lookup" | "allocation" | "startup wait" | "readiness" | "SSH grant" | "probe";
type SnapshotPublicationPhase = "snapshot POST" | "snapshot reconciliation GET" | "snapshot status GET";

export class InstaboxPreparationError extends Error {
  readonly phase: PreparationPhase | SnapshotPublicationPhase;
  readonly detail: InstaboxErrorDetail;
  readonly kind: SandboxProvisionErrorKind;

  constructor(
    phase: InstaboxPreparationError["phase"],
    detail: InstaboxErrorDetail,
    kind: SandboxProvisionErrorKind = "unknown",
  ) {
    const facts = [
      detail.status === undefined ? undefined : `HTTP ${detail.status}`,
      detail.code,
      detail.requestId === undefined ? undefined : `requestId=${detail.requestId}`,
      detail.retryable === undefined ? undefined : `retryable=${detail.retryable}`,
      detail.retryAfterSeconds === undefined ? undefined : `retryAfterSeconds=${detail.retryAfterSeconds}`,
      detail.retryDelaySeconds === undefined ? undefined : `Retry-After=${detail.retryDelaySeconds}s`,
      detail.reason === undefined ? undefined : `reason=${detail.reason}`,
      detail.message,
    ].filter((part) => part !== undefined);
    super(`Instabox ${phase} failed: ${facts.join(", ")}`);
    this.phase = phase;
    this.detail = detail;
    this.kind = kind;
  }

  get snapshotAbsent(): boolean {
    return this.phase === "snapshot lookup" && this.detail.status === 404 && this.detail.code === "not_found";
  }

  get diagnosticCauses() {
    const { status, code, requestId, retryable, retryAfterSeconds, retryDelaySeconds, reason, message } = this.detail;
    const diagnosticCode = (code ?? "instabox-restore-failed").replaceAll("_", "-");
    // Attempt Show displays up to 128 bytes per cause. Keep long request IDs and
    // retry advice visible within that budget alongside the primary cause.
    if (this.message.length <= 128) return [{ code: diagnosticCode, summary: this.message }];
    return [
      {
        code: diagnosticCode,
        summary: [`Instabox ${this.phase} failed`, status === undefined ? undefined : `HTTP ${status}`, code]
          .filter((part) => part !== undefined)
          .join(", "),
      },
      ...(requestId === undefined ? [] : [{ code: "instabox-request-id", summary: `requestId=${requestId}` }]),
      ...(retryable === undefined && retryAfterSeconds === undefined && reason === undefined
        ? []
        : [
            {
              code: "instabox-retry-advice",
              summary: [
                retryable === undefined ? undefined : `retryable=${retryable}`,
                retryAfterSeconds === undefined ? undefined : `retryAfterSeconds=${retryAfterSeconds}`,
                retryDelaySeconds === undefined ? undefined : `Retry-After=${retryDelaySeconds}s`,
                reason === undefined ? undefined : `reason=${reason}`,
              ]
                .filter((part) => part !== undefined)
                .join(", "),
            },
          ]),
      ...(message === undefined ? [] : [{ code: "instabox-message", summary: boundedErrorText(message, 128) }]),
    ];
  }
}

export function preparationFailure(
  phase: InstaboxPreparationError["phase"],
  cause: unknown,
  kind = provisionKind(cause),
): InstaboxPreparationError {
  if (cause instanceof InstaboxApiError)
    return new InstaboxPreparationError(phase, { ...cause.detail, code: cause.code }, kind);
  const code =
    cause instanceof InstaboxProtocolError
      ? "invalid-protocol-response"
      : cause instanceof Error && cause.name === "TimeoutError"
        ? "request-timeout"
        : "transport-failure";
  return new InstaboxPreparationError(phase, { code }, kind);
}

const classifyInstaboxReadError = (error: unknown) => {
  if (error instanceof InstaboxApiError) {
    if (error.detail.retryable === false || error.code === "quota_exceeded") return "unknown";
    return classifySandboxIoError({ status: error.status });
  }
  return classifySandboxIoError(error);
};

// Explicit delay advice belongs to the provisioning budget rather than the short IO retry.
const hasRetryAdvice = (error: unknown) => error instanceof InstaboxApiError && instaboxRetryDelayMs(error.detail) > 0;

export const isRetryableInstaboxReadError = (error: unknown) =>
  isRetryableSandboxIoError(classifyInstaboxReadError(error));

export function instaboxReadRequest<T>(run: (signal: AbortSignal) => Promise<T>) {
  return withSandboxIoRetry(providerBoundaryEffect(run), { classify: classifyInstaboxReadError });
}

export function preparationRequest<T>(
  phase: Exclude<PreparationPhase, "allocation" | "probe">,
  run: (signal: AbortSignal) => Promise<T>,
) {
  return withSandboxIoRetry(providerBoundaryEffect(run), {
    classify: (error) => {
      if (hasRetryAdvice(error)) return "unknown";
      if (phase === "SSH grant") return isRejectedProvisionError(provisionKind(error)) ? "network" : "unknown";
      return classifyInstaboxReadError(error);
    },
  }).pipe(Effect.mapError((cause) => preparationFailure(phase, cause)));
}
