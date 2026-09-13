import { slotExecutionIdentityDigestHex } from "./execution-identity.ts";
import type { RunContext } from "../record/model/run-context.ts";

/** Absence must be captured by the producer, never inferred from missing activities. */
export function hasProvenNoExperimentHooks(context: RunContext): boolean {
  const hooks = context.execution.experimentHooks;
  return hooks?.version === 1 && hooks.setup === "absent" && hooks.teardown === "absent";
}

/** Frozen current inputs; reconstruction never consults historical configuration. */
export interface RenameIdentityTarget {
  readonly experimentId: string;
  readonly evalId: string;
  readonly attempt: number;
  readonly executionIdentityDigest: string;
  readonly inputIdentity: { readonly domain: string; readonly value: string };
  readonly configIdentity: { readonly domain: string; readonly value: string };
  readonly timeout?: { readonly domain: string; readonly milliseconds: number };
  readonly renameFingerprint?: (experimentId: string) => string | undefined;
}

/** First-party experiment-rename/v1 proof, shared by explicit adoption and later reuse. */
export function executionDigestForExperiment(target: RenameIdentityTarget, experimentId: string): string | undefined {
  if (experimentId === target.experimentId) return target.executionIdentityDigest;
  if (target.inputIdentity.domain !== "niceeval.input/fingerprint-v1" || target.configIdentity.domain !== "niceeval.config/identity-v1") return undefined;
  const fingerprint = target.renameFingerprint?.(experimentId);
  if (fingerprint === undefined) return undefined;
  return slotExecutionIdentityDigestHex({
    experimentId, evalId: target.evalId, attempt: target.attempt,
    input: { domain: target.inputIdentity.domain, value: fingerprint },
    config: target.configIdentity,
    timeout: target.timeout ?? null,
  });
}
