// @concord-file
// @concord-implements docs/feature/judge/architecture.md
import { Data, Schema } from "effect";
import type { Usage } from "@earendil-works/pi-ai";
import type { ResolvedJudgeConfig } from "../assertions/types.ts";
import { resolveJudgeCredential } from "./provider.ts";

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
  readonly cause?: unknown;
}> {}

export function piDefect(cause: unknown): PiFailure {
  return cause instanceof PiFailure
    ? cause
    : new PiFailure({ kind: "defect", message: cause instanceof Error ? cause.message : "Unexpected pi failure", cause });
}

export function managedPiCredential(profile: ResolvedJudgeConfig | undefined): string {
  if (profile === undefined)
    throw new PiFailure({ kind: "provider", message: "Judge Provider is not configured" });
  const credential = resolveJudgeCredential(profile);
  if (!credential)
    throw new PiFailure({ kind: "credential", message: "Judge Provider credential is unresolved" });
  return credential;
}

const tokenCount = Schema.Number.check(Schema.makeFilter(value => Number.isSafeInteger(value) && value >= 0));
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
    return new PiFailure({ kind: "defect", message: "pi returned invalid usage", cause });
  }
}

/** Only this bounded text is persisted. Raw SDK causes stay in runtime memory. */
export function safePiFailureMessage(error: PiFailure, profile?: ResolvedJudgeConfig): string {
  let text = error.message;
  const secrets = [profile?.baseUrl, ...Object.values(profile?.headers ?? {})];
  if (profile !== undefined) {
    try { secrets.push(resolveJudgeCredential(profile)); } catch { /* No credential is available. */ }
  }
  for (const secret of secrets)
    if (secret) text = text.split(secret).join("[redacted]");
  // SDK/provider messages may contain a request URL or an echoed header block.
  text = text.replace(/https?:\/\/[^\s"'<>]+/giu, "[redacted endpoint]")
    .replace(/\b(?:authorization|proxy-authorization|api[-_]?key|x-api-key|cookie|set-cookie)\s*[=:]\s*[^\r\n]*/giu, "[redacted header]");
  return Array.from(text).slice(0, 1024).join("");
}
