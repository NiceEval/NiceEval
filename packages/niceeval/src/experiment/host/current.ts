import { createHash } from "node:crypto";
import { Data, Effect, Schema, type Cause } from "effect";
import { normalizeExperimentHostCause, type ExperimentHostCause } from "./types.ts";
import { prepareRuns } from "./operations.ts";
import { planPreparedProjectTarget, planProjectTarget } from "../../runner/fingerprint.ts";
import { prepareRunnerRecordReuse } from "../../runner/record/planning.ts";
import { cacheKey } from "../../runner/fingerprint.ts";
import { slotExecutionIdentityDigestHex } from "../../runner/execution-identity.ts";
import { ExecutionIdentityDigestSchema } from "../../record/codec/identifiers.ts";
import { adapterIdentity } from "../../adapter.ts";
import type { Config } from "../../runner/types.ts";
import {
  assessCurrentTargetSlot,
  type CurrentAssessmentAttempt,
  type CurrentAssessmentSource,
  type CurrentAssessmentInput,
  type CurrentTargetSlot,
  type ProjectTargetPolicy,
} from "../../runner/reuse-plan.ts";

export class CurrentTargetUnavailable extends Data.TaggedError("CurrentTargetUnavailable")<{
  readonly code: "current-target-unavailable";
  readonly reason: string;
  readonly cause: ExperimentHostCause | Cause.Cause<ExperimentHostCause>;
}> {}

export interface FrozenCurrentTarget {
  readonly identity: string;
  readonly policy: ProjectTargetPolicy;
  readonly experiments: readonly {
    readonly experimentId: string;
    readonly adapter: ReturnType<typeof adapterIdentity>;
    readonly model: string | undefined;
    readonly labels: Readonly<Record<string, string | number>>;
  }[];
  readonly slots: readonly CurrentTargetSlot[];
}

/** No Run/Slot allocation, Record access, occupancy or lifecycle dispatch. */
export const prepareCurrentTarget = Effect.fn("ExperimentHost.prepareCurrentTarget")(function* (input: {
  readonly cwd: string;
  readonly config: Config;
  readonly freshImport: boolean | undefined;
}): Effect.fn.Return<FrozenCurrentTarget, CurrentTargetUnavailable> {
  const candidate = yield* Effect.gen(function* () {
    const prepared = yield* prepareRuns(input, {
      allowEmptySelection: true,
      freshImport: input.freshImport ?? false,
    });
    if (prepared.status !== "ready") return yield* Effect.fail(new Error(JSON.stringify(prepared.problem)));
    const planned = yield* planProjectTarget(prepared.selected.evals, prepared.runs, input.config.timeoutMs, {
      configJudge: input.config.judgeProvider,
      keepSandbox: undefined,
    });
    const reuse = yield* prepareRunnerRecordReuse({
      manifestsByKey: planned.manifestsByKey,
      preparedPairsByKey: planned.preparedPairsByKey,
      evals: prepared.selected.evals,
      runs: prepared.runs,
      config: input.config,
      plannedFingerprints: planned.plannedFingerprints,
      plannedConfigHashes: planned.plannedConfigHashes,
      renameFingerprintsByKey: planned.renameFingerprintsByKey,

      rerun: undefined,
      keepSandbox: undefined,
    });
    const slots: CurrentTargetSlot[] = [];
    for (const run of prepared.runs) {
      for (const definition of prepared.selected.evals.filter((evalDef) => run.selectedEvalIds.includes(evalDef.id))) {
        const slotInput = reuse.slotsByKey.get(cacheKey(run, definition.id))!;
        for (let attempt = 0; attempt < run.attempts; attempt++) {
          const digest = yield* Schema.decodeUnknownEffect(ExecutionIdentityDigestSchema)(
            slotExecutionIdentityDigestHex({
              experimentId: run.experimentId,
              evalId: definition.id,
              attempt,
              input: slotInput.inputIdentity,
              config: slotInput.configIdentity,
              timeout: slotInput.timeout ?? null,
            }),
          );
          slots.push({
            ...slotInput,
            experimentId: run.experimentId,
            evalId: definition.id,
            attempt,
            evaluationKind: definition.evaluationKind,
            executionIdentityDigest: digest,
            reuseEligibility:
              run.adapter?.kind === "custom" && run.adapter.behaviorRevision === undefined
                ? { kind: "adapter-behavior-revision-required" }
                : slotInput.reuseEligibility,
          });
        }
      }
    }
    // Re-read identity inputs without re-evaluating declarations or resources.
    const verified = yield* planPreparedProjectTarget([...planned.preparedPairsByKey.values()], {
      configJudge: input.config.judgeProvider,
      keepSandbox: undefined,
      configTimeoutMs: input.config.timeoutMs,
    });
    if ([...planned.plannedFingerprints].some(([key, value]) => verified.plannedFingerprints.get(key) !== value)) {
      return yield* Effect.fail(new Error("Current project inputs changed during evaluation; retry the request."));
    }
    slots.sort(
      (left, right) =>
        compare(left.experimentId, right.experimentId) ||
        compare(left.evalId, right.evalId) ||
        left.attempt - right.attempt,
    );
    const experiments = prepared.runs
      .map((run) => ({
        experimentId: run.experimentId,
        adapter: adapterIdentity(run.adapter),
        model: run.model,
        labels: { ...(run.labels ?? {}) },
      }))
      .sort((left, right) => compare(left.experimentId, right.experimentId));
    const identity = createHash("sha256")
      .update(JSON.stringify({ experiments, slots: slots.map(({ renameFingerprint: _rename, ...slot }) => slot) }))
      .digest("hex");
    return { identity, policy: reuse.policy, experiments, slots };
  }).pipe(
    Effect.mapError(normalizeExperimentHostCause),
    Effect.catchCause((cause) =>
      Effect.fail(
        new CurrentTargetUnavailable({
          code: "current-target-unavailable",
          reason: String(cause),
          cause,
        }),
      ),
    ),
  );
  return candidate;
});

function compare(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/** The Host assesses its frozen logical target using the caller's pinned facts. */
export const assessCurrentTarget = <
  Ref,
  Attempt extends CurrentAssessmentAttempt,
  Source extends CurrentAssessmentSource,
  Error,
>(
  target: FrozenCurrentTarget,
  facts: Omit<CurrentAssessmentInput<Ref, Attempt, Source, CurrentTargetSlot, Error>, "target" | "policy">,
) =>
  Effect.forEach(target.slots, (slot) => assessCurrentTargetSlot({ ...facts, target: slot, policy: target.policy }), {
    concurrency: 1,
  });
