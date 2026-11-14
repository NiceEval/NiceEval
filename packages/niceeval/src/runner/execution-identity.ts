import { createHash } from "node:crypto";

/** Stable object-key encoding shared by the fingerprint and config recipes. */
export function stableIdentityJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "undefined";
  if (Array.isArray(value)) return `[${value.map(stableIdentityJson).join(",")}]`;
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => `${JSON.stringify(key)}:${stableIdentityJson(child)}`)
    .join(",")}}`;
}

/** Exact hashing recipe for frozen Eval input and configuration payloads. */
export function hashIdentityPayload(value: unknown): string {
  return createHash("sha256").update(stableIdentityJson(value)).digest("hex");
}

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
