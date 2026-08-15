import type { AttemptId } from "./record/index.ts";
import { sha256 } from "./shared/sha256.ts";

/** Canonical, human-facing alias for one exact durable AttemptId. */
export type AttemptLocator = string & { readonly __brand: "AttemptLocator" };

export const ATTEMPT_LOCATOR_PATTERN = /^@1[0-9A-HJKMNP-TV-Z]{12}$/;

const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export interface AttemptLocatorMalformed {
  readonly code: "attempt-locator-malformed";
  readonly input: string;
}

export type AttemptLocatorParseResult =
  | { readonly valid: true; readonly locator: AttemptLocator }
  | { readonly valid: false; readonly error: AttemptLocatorMalformed };

/** Strict parser: no trimming, case folding, fuzzy Crockford characters, or legacy @UUID. */
export function parseAttemptLocator(input: string): AttemptLocatorParseResult {
  return ATTEMPT_LOCATOR_PATTERN.test(input)
    ? Object.freeze({ valid: true as const, locator: input as AttemptLocator })
    : Object.freeze({
        valid: false as const,
        error: Object.freeze({ code: "attempt-locator-malformed" as const, input }),
      });
}

/**
 * SHA-256(exact AttemptId UTF-8), first 60 bits, big-endian Crockford base32.
 * The implementation is runtime-neutral so Node CLI and browser Reports share
 * one encoder without depending on Node crypto or asynchronous Web Crypto.
 */
export function encodeAttemptLocator(attemptId: AttemptId): AttemptLocator {
  const digest = sha256(new TextEncoder().encode(attemptId));
  let prefix = 0n;
  for (let index = 0; index < 8; index += 1) {
    prefix = (prefix << 8n) | BigInt(digest[index]!);
  }
  prefix >>= 4n;
  let body = "";
  for (let index = 0; index < 12; index += 1) {
    body = CROCKFORD_ALPHABET[Number(prefix & 31n)]! + body;
    prefix >>= 5n;
  }
  return `@1${body}` as AttemptLocator;
}
