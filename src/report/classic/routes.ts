import { Either } from "effect";
import type { AttemptId } from "../../analysis/index.ts";
import { Sha256 } from "../../shared/sha256.ts";
import {
  reportInstanceKeyFromRecordId,
  reportInstanceKey,
  reportRoute,
  reportRouteFromKeys,
  type ReportInstanceKey,
  type ReportRoute,
} from "../author/index.ts";
import type { ReportLinkTarget } from "../semantic/document.ts";
import type { Sample } from "./sample.ts";

const EXPERIMENT_ROUTE_PREFIX = new Uint8Array([
  0x6e, 0x69, 0x63, 0x65, 0x65, 0x76, 0x61, 0x6c,
  0x2f, 0x72, 0x65, 0x70, 0x6f, 0x72, 0x74, 0x2f,
  0x65, 0x78, 0x70, 0x65, 0x72, 0x69, 0x6d, 0x65,
  0x6e, 0x74, 0x2d, 0x72, 0x6f, 0x75, 0x74, 0x65,
  0x2f, 0x76, 0x31, 0x00,
]);
const EXPERIMENT_ROUTE_SEGMENT = "experiment-v1";
const EXPERIMENT_INSTANCE_KEY_PREFIX = "experiment-v1-";
const EXPERIMENT_CODE_UNIT_CHUNK = 4096;

/** Unique experiment identities already present on the closed Sample. */
export function classicExperimentIds(sample: Sample): readonly string[] {
  const ids = new Set<string>();
  for (const unit of sample.units) {
    ids.add(unit.experimentId);
  }
  return Object.freeze([...ids].sort());
}

export function classicExperimentInstanceKey(experimentId: string): ReportInstanceKey {
  const digest = classicExperimentDigest(experimentId);
  return Either.getOrThrow(reportInstanceKey(`${EXPERIMENT_INSTANCE_KEY_PREFIX}${digest}`));
}

/**
 * The classic experiment PageFamily owns this v1 namespace. Its hash target
 * accepts every valid ExperimentId without applying the generic route grammar.
 */
export function classicExperimentRoute(experimentId: string): ReportRoute {
  return Either.getOrThrow(reportRoute(`/${EXPERIMENT_ROUTE_SEGMENT}/${classicExperimentDigest(experimentId)}`));
}

/** Total route target for a valid ExperimentId already present on the Sample. */
export function classicExperimentTarget(experimentId: string): Extract<ReportLinkTarget, { readonly kind: "route" }> {
  return Object.freeze({
    kind: "route" as const,
    route: classicExperimentRoute(experimentId),
  });
}

export function classicAttemptInstanceKey(attemptId: AttemptId): ReportInstanceKey {
  return reportInstanceKeyFromRecordId({
    kind: "attempt",
    value: attemptId,
  });
}

export function classicAttemptRoute(attemptId: AttemptId): ReportRoute {
  return Either.getOrThrow(reportRouteFromKeys([classicAttemptInstanceKey(attemptId)]));
}

export function classicAttemptTarget(attemptId: AttemptId): Extract<ReportLinkTarget, { readonly kind: "route" }> {
  return Object.freeze({
    kind: "route" as const,
    route: classicAttemptRoute(attemptId),
  });
}

/** Closed Sample narrowing: keep only one experiment's already-projected units. */
export function narrowClassicSampleToExperiment(sample: Sample, experimentId: string): Sample {
  const units = Object.freeze(sample.units.filter((unit) => unit.experimentId === experimentId));
  const attempts = Object.freeze(sample.attempts.filter((attempt) => attempt.experimentId === experimentId));
  const runIds = new Set(attempts.map((attempt) => attempt.runId));
  const profile = sample.profiles[experimentId];
  return Object.freeze({
    ...sample,
    runCount: runIds.size,
    runs: Object.freeze(sample.runs.filter((run) => runIds.has(run.runId))),
    profiles: Object.freeze(profile === undefined ? {} : { [experimentId]: profile }),
    units,
    attempts,
  });
}

/**
 * Lowercase SHA-256 over the exact JavaScript UTF-16 code-unit sequence.
 * This is deliberately not UTF-8: lone surrogates must retain their identity.
 */
export function classicExperimentDigest(experimentId: string): string {
  if (experimentId.length === 0) {
    throw new TypeError("an experiment id must be a non-empty string");
  }

  const hash = new Sha256()
    .update(EXPERIMENT_ROUTE_PREFIX)
    .update(encodeU64BE(experimentId.length));
  const chunk = new Uint8Array(EXPERIMENT_CODE_UNIT_CHUNK * 2);
  for (let start = 0; start < experimentId.length; start += EXPERIMENT_CODE_UNIT_CHUNK) {
    const count = Math.min(EXPERIMENT_CODE_UNIT_CHUNK, experimentId.length - start);
    for (let index = 0; index < count; index += 1) {
      const codeUnit = experimentId.charCodeAt(start + index);
      const byteOffset = index * 2;
      chunk[byteOffset] = codeUnit >>> 8;
      chunk[byteOffset + 1] = codeUnit;
    }
    hash.update(chunk.subarray(0, count * 2));
  }
  return lowercaseHex(hash.digest());
}

function encodeU64BE(value: number): Uint8Array {
  const bytes = new Uint8Array(8);
  let remaining = BigInt(value);
  for (let index = bytes.length - 1; index >= 0; index -= 1) {
    bytes[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return bytes;
}

function lowercaseHex(bytes: Uint8Array): string {
  let result = "";
  for (const byte of bytes) {
    result += byte.toString(16).padStart(2, "0");
  }
  return result;
}
