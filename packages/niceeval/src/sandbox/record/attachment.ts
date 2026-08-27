import { Result, Schema } from "effect";
import { SandboxAttachmentPayloadSchema } from "./codec.ts";
import type { SandboxAttachmentPayload, SandboxReuse } from "./model.ts";

/**
 * Sandbox assignment is execution coordination, not a Record family. The
 * only durable sandbox-produced facts are File Changes captured by the fixed
 * `niceeval.file-changes` collector.
 */
export type SandboxCaptureInput =
  | { readonly state: "not-used" }
  | {
      readonly state: "assigned";
      readonly provider: string;
      readonly sandboxId: string;
      readonly reuse:
        | { readonly kind: "fresh" }
        | { readonly kind: "pooled"; readonly sandbox: number; readonly ordinal: number };
    };

export type SandboxCaptureInputError = {
  readonly code: "sandbox-capture-input-invalid";
};

const invalid: SandboxCaptureInputError = Object.freeze({
  code: "sandbox-capture-input-invalid" as const,
});

function freezeReuse(reuse: SandboxReuse): SandboxReuse {
  return reuse.kind === "fresh"
    ? Object.freeze({ kind: "fresh" as const })
    : Object.freeze({
        kind: "pooled" as const,
        sandbox: reuse.sandbox,
        ordinal: reuse.ordinal,
      });
}

/** Validates a transient capture value without producing a Record write. */
export function normalizeSandboxCapture(
  input: SandboxCaptureInput,
): Result.Result<SandboxAttachmentPayload, SandboxCaptureInputError> {
  const decoded = Schema.decodeUnknownResult(SandboxAttachmentPayloadSchema, {
    errors: "all",
    onExcessProperty: "error",
  })(input);
  if (Result.isFailure(decoded)) return Result.fail(invalid);
  return Result.succeed(
    decoded.success.state === "not-used"
      ? Object.freeze({ state: "not-used" as const })
      : Object.freeze({
          state: "assigned" as const,
          provider: decoded.success.provider,
          sandboxId: decoded.success.sandboxId,
          reuse: freezeReuse(decoded.success.reuse),
        }),
  );
}
