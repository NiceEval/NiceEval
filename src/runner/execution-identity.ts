import { createHash } from "node:crypto";

/**
 * Stable JSON for one Slot's execution identity. Object-key order is fixed so
 * ambient insertion cannot change the Core digest.
 */
export function slotExecutionIdentityInput(input: {
  readonly experimentId: string;
  readonly evalId: string;
  readonly attempt: number;
  readonly input: { readonly domain: string; readonly value: string };
  readonly config: { readonly domain: string; readonly value: string };
  readonly timeout: null | { readonly domain: string; readonly milliseconds: number };
}): string {
  return JSON.stringify({
    version: 1,
    experimentId: input.experimentId,
    evalId: input.evalId,
    attempt: input.attempt,
    input: { domain: input.input.domain, value: input.input.value },
    config: { domain: input.config.domain, value: input.config.value },
    timeout: input.timeout,
  });
}

/** SHA-256 hex of {@link slotExecutionIdentityInput}. */
export function slotExecutionIdentityDigestHex(input: {
  readonly experimentId: string;
  readonly evalId: string;
  readonly attempt: number;
  readonly input: { readonly domain: string; readonly value: string };
  readonly config: { readonly domain: string; readonly value: string };
  readonly timeout: null | { readonly domain: string; readonly milliseconds: number };
}): string {
  return createHash("sha256").update(slotExecutionIdentityInput(input), "utf8").digest("hex");
}
