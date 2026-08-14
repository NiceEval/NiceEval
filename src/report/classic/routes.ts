import { Either } from "effect";
import type { AttemptId } from "../../analysis/index.ts";
import {
  reportInstanceKeyFromRecordId,
  reportRoute,
  reportRouteFromKeys,
  type ReportInstanceKey,
  type ReportRoute,
} from "../author/index.ts";
import { reportInstanceKeyFromUtf8 } from "../author/identity.ts";
import type { ReportLinkTarget } from "../semantic/document.ts";
import type { Sample } from "./sample.ts";

const ROUTE_SEGMENT = /^[a-z0-9][a-z0-9._~-]*$/;

/** Unique experiment identities already present on the closed Sample. */
export function classicExperimentIds(sample: Sample): readonly string[] {
  const ids = new Set<string>();
  for (const unit of sample.units) {
    ids.add(unit.experimentId);
  }
  return Object.freeze([...ids].sort());
}

export function classicExperimentInstanceKey(experimentId: string): ReportInstanceKey {
  experimentRouteSegments(experimentId);
  return reportInstanceKeyFromUtf8("experiment", experimentId);
}

/**
 * Experiment detail route preserves the authored id path so static export and
 * live view share one explicit `index.html` target, e.g. `classic/baseline`
 * becomes `/experiment/classic/baseline`.
 */
export function classicExperimentRoute(experimentId: string): ReportRoute {
  const parsed = reportRoute(`/experiment/${experimentRouteSegments(experimentId).join("/")}`);
  if (Either.isLeft(parsed)) {
    throw new TypeError(`experiment id ${JSON.stringify(experimentId)} cannot form a Report route`);
  }
  return parsed.right;
}

export function classicExperimentTarget(experimentId: string): Extract<ReportLinkTarget, { readonly kind: "route" }> | undefined {
  try {
    return Object.freeze({
      kind: "route" as const,
      route: classicExperimentRoute(experimentId),
    });
  } catch {
    return undefined;
  }
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

function experimentRouteSegments(experimentId: string): readonly string[] {
  if (experimentId.length === 0) {
    throw new TypeError("an experiment id must be a non-empty string");
  }
  const segments = experimentId.split("/");
  if (segments.some((segment) => segment.length === 0 || !ROUTE_SEGMENT.test(segment))) {
    throw new TypeError(`experiment id ${JSON.stringify(experimentId)} is not a portable Report route`);
  }
  return Object.freeze(segments);
}
