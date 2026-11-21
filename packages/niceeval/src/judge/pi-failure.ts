// @concord-file
// @concord-implements docs/feature/judge/architecture.md
import { REDACTED_SENSITIVE_VALUE, type RedactEvidenceText } from "../sandbox/redaction.ts";
import { Data, Schema } from "effect";
import type { Usage } from "@earendil-works/pi-ai";
import type { ResolvedJudgeConfig } from "../assertions/types.ts";
import type { RememberAttemptCredentials } from "../context/attempt-sensitive-values.ts";
import { resolveJudgeCredential } from "./provider.ts";
import { normalizeExternalCause, type ExternalCause } from "../shared/external-cause.ts";

/** Provenance at the SDK boundary; messages are evidence, never classifiers. */
export type PiFailureKind =
  | "dependency"
  | "provider"
  | "credential"
  | "session-init"
  | "model-request"
  | "context-overflow"
  | "cancelled"
  | "defect";

export class PiFailure extends Data.TaggedError("PiFailure")<{
  readonly kind: PiFailureKind;
  readonly message: string;
  readonly cause: ExternalCause | undefined;
}> {}

export function piDefect(cause: unknown): PiFailure {
  return cause instanceof PiFailure
    ? cause
    : new PiFailure({
        kind: "defect",
        message: cause instanceof Error ? cause.message : "Unexpected pi failure",
        cause: normalizeExternalCause(cause),
      });
}

export function managedPiCredential(
  profile: ResolvedJudgeConfig | undefined,
  remember?: RememberAttemptCredentials,
): string {
  if (profile === undefined)
    throw new PiFailure({
      kind: "provider",
      message: "Judge Provider is not configured",
      cause: undefined,
    });
  const credential = resolveJudgeCredential(profile);
  if (!credential)
    throw new PiFailure({
      kind: "credential",
      message: "Judge Provider credential is unresolved",
      cause: undefined,
    });
  remember?.(credential, ...Object.values(profile.headers ?? {}));
  return credential;
}

const tokenCount = Schema.Number.check(Schema.makeFilter((value) => Number.isSafeInteger(value) && value >= 0));
const UsageSchema = Schema.Struct({
  input: tokenCount,
  output: tokenCount,
  cacheRead: tokenCount,
  cacheWrite: tokenCount,
  totalTokens: tokenCount,
});

/** Reject corrupted SDK usage before collectors or pricing can interpret it. */
export function piUsageFailure(usage: Usage): PiFailure | undefined {
  try {
    Schema.decodeUnknownSync(UsageSchema)(usage);
    return undefined;
  } catch (cause) {
    return new PiFailure({
      kind: "defect",
      message: "pi returned invalid usage",
      cause: normalizeExternalCause(cause),
    });
  }
}

/** Removes configured secrets and echoed endpoint or header text without bounding the length. */
function redactPiText(text: string, profile?: ResolvedJudgeConfig, endpoints = true): string {
  const secrets = [profile?.baseUrl, ...Object.values(profile?.headers ?? {})];
  if (profile !== undefined) {
    try {
      secrets.push(resolveJudgeCredential(profile));
    } catch {
      /* No credential is available. */
    }
  }
  for (const secret of secrets) if (secret) text = text.split(secret).join("[redacted]");
  // SDK/provider messages may contain a request URL or an echoed header block.
  if (endpoints) text = text.replace(/https?:\/\/[^\s"'<>]+/giu, "[redacted endpoint]");
  return text.replace(
    /\b(?:authorization|proxy-authorization|api[-_]?key|x-api-key|cookie|set-cookie)\s*[=:]\s*[^\r\n]*/giu,
    (header) =>
      header.includes(REDACTED_SENSITIVE_VALUE) ? `[redacted header] ${REDACTED_SENSITIVE_VALUE}` : "[redacted header]",
  );
}

/** Only this bounded text is persisted. Raw SDK causes stay in runtime memory. */
export function safePiFailureMessage(
  error: PiFailure,
  profile?: ResolvedJudgeConfig,
  redact?: RedactEvidenceText,
): string {
  return Array.from(redactPiText(redact?.(error.message) ?? error.message, profile))
    .slice(0, 1024)
    .join("");
}

/**
 * Redacts every string of a pi session history before it is sealed as audit evidence.
 * Unrelated URLs stay: the history also holds author material the audit must show verbatim.
 */
export function redactPiSessionEntries<T>(value: T, profile?: ResolvedJudgeConfig): T {
  if (typeof value === "string") return redactPiText(value, profile, false) as T;
  if (Array.isArray(value)) return value.map((item) => redactPiSessionEntries(item, profile)) as T;
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, redactPiSessionEntries(item, profile)]),
    ) as T;
  return value;
}
