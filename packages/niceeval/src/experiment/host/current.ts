import { createHash } from "node:crypto";
import { Data, Effect, Schema } from "effect";
import { prepareRuns } from "./operations.ts";
import { planPreparedProjectTarget, planProjectTarget } from "../../runner/fingerprint.ts";
import { prepareRunnerRecordReuse } from "../../runner/record/planning.ts";
import { cacheKey } from "../../runner/fingerprint.ts";
import { slotExecutionIdentityDigestHex } from "../../runner/execution-identity.ts";
import { ExecutionIdentityDigestSchema } from "../../record/codec/identifiers.ts";
import { adapterIdentity } from "../../adapter.ts";
import type { Config } from "../../runner/types.ts";
import { assessCurrentTargetSlot, type CurrentAssessmentAttempt, type CurrentAssessmentSource, type CurrentAssessmentInput, type CurrentTargetSlot, type ProjectTargetPolicy } from "../../runner/reuse-plan.ts";

export class CurrentTargetUnavailable extends Data.TaggedError("CurrentTargetUnavailable")<{
  readonly code: "current-target-unavailable";
  readonly reason: string;
  readonly cause?: unknown;
}> {}

export interface FrozenCurrentTarget {
  readonly identity: string;
  readonly policy: ProjectTargetPolicy;
  readonly experiments: readonly {
    readonly experimentId: string;
    readonly adapter: ReturnType<typeof adapterIdentity>;
    readonly model: string | undefined;
    readonly labels: Readonly<Record<string, string>>;
  }[];
  readonly slots: readonly CurrentTargetSlot[];
}

/** No Run/Slot allocation, Record access, occupancy or lifecycle dispatch. */
export const prepareCurrentTarget = Effect.fn("ExperimentHost.prepareCurrentTarget")(function*(input: {
  readonly cwd: string;
  readonly config: Config;
}): Effect.fn.Return<FrozenCurrentTarget, CurrentTargetUnavailable> {
  const candidate = yield* Effect.gen(function* () {
    const prepared = yield* prepareRuns(input, { allowEmptySelection: true });
    if (prepared.status !== "ready") return yield* Effect.fail(new Error(JSON.stringify(prepared.problem)));
    const planned = yield* planProjectTarget(prepared.selected.evals, prepared.runs, input.config.timeoutMs, { configJudge: input.config.judgeRuntime });
    const reuse = yield* prepareRunnerRecordReuse({
      evals: prepared.selected.evals,
      runs: prepared.runs,
      config: input.config,
      plannedFingerprints: planned.plannedFingerprints,
      plannedConfigHashes: planned.plannedConfigHashes,
      renameFingerprintsByKey: planned.renameFingerprintsByKey,
    });
    const slots: CurrentTargetSlot[] = [];
    for (const run of prepared.runs) {
      for (const definition of prepared.selected.evals.filter((evalDef) => run.selectedEvalIds.includes(evalDef.id))) {
        const slotInput = reuse.slotsByKey.get(cacheKey(run, definition.id))!;
        for (let attempt = 0; attempt < run.attempts; attempt++) {
          const digest = yield* Schema.decodeUnknownEffect(ExecutionIdentityDigestSchema)(slotExecutionIdentityDigestHex({
            experimentId: run.experimentId, evalId: definition.id, attempt,
            input: slotInput.inputIdentity, config: slotInput.configIdentity, timeout: slotInput.timeout ?? null,
          }));
          slots.push(Object.freeze({
            ...slotInput,
            experimentId: run.experimentId,
            evalId: definition.id,
            attempt,
            evaluationKind: definition.evaluationKind,
            executionIdentityDigest: digest,
            ...(run.adapter.kind === "custom" && run.adapter.behaviorRevision === null ? { reuseEligibility: "adapter-behavior-revision-required" as const } : {}),
          }));
        }
      }
    }
    // Re-read identity inputs without re-evaluating declarations or resources.
    const verified = yield* planPreparedProjectTarget([...planned.preparedPairsByKey.values()], { configJudge: input.config.judgeRuntime });
    if ([...planned.plannedFingerprints].some(([key, value]) => verified.plannedFingerprints.get(key) !== value)) {
      return yield* Effect.fail(new Error("Current project inputs changed during evaluation; retry the request."));
    }
    slots.sort((left, right) => compare(left.experimentId, right.experimentId) || compare(left.evalId, right.evalId) || left.attempt - right.attempt);
    const experiments = Object.freeze(prepared.runs.map((run) => Object.freeze({
      experimentId: run.experimentId, adapter: adapterIdentity(run.adapter), model: run.model,
      labels: Object.freeze(Object.fromEntries(Object.entries(run.labels ?? {}).map(([key, value]) => [key, String(value)]))),
    })).sort((left, right) => compare(left.experimentId, right.experimentId)));
    const identity = createHash("sha256").update(JSON.stringify({ experiments, slots: slots.map(({ renameFingerprint: _rename, ...slot }) => slot) })).digest("hex");
    return Object.freeze({ identity, policy: reuse.policy, experiments, slots: Object.freeze(slots) });
  }).pipe(Effect.catchCause((cause) => Effect.fail(new CurrentTargetUnavailable({
    code: "current-target-unavailable", reason: String(cause), cause,
  }))));
  return candidate;
});

function compare(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }

/** The Host assesses its frozen logical target using the caller's pinned facts. */
export const assessCurrentTarget = <Ref, Attempt extends CurrentAssessmentAttempt, Source extends CurrentAssessmentSource, Error>(
  target: FrozenCurrentTarget,
  facts: Omit<CurrentAssessmentInput<Ref, Attempt, Source, CurrentTargetSlot, Error>, "target" | "policy">,
) => Effect.forEach(target.slots, (slot) => assessCurrentTargetSlot({ ...facts, target: slot, policy: target.policy }), { concurrency: 1 }).pipe(
  Effect.map((slots) => Object.freeze(slots)),
);
