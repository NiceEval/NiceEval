// cases: docs/engineering/testing/unit/experiments-runner.md

import { Effect, Schema } from "effect";
import { expect, it } from "vitest";
import { AssertionEntryIdSchema } from "../assertions/record/codec.ts";
import { AttemptDocumentSchema, RecordSlotIdentitySchema } from "../record/codec/core.ts";
import { ExperimentIdSchema, RunIdSchema, UtcMillisSchema } from "../record/codec/identifiers.ts";
import type { AssertionsAttachment } from "../record/family/assertions/definition.ts";
import {
  assessCurrentTargetSlot,
  projectTargetPolicyIdentity,
  type CurrentAssessmentRun,
  type CurrentTargetSlot,
} from "./reuse-plan.ts";

it("完整执行仍不能沿用含不适用计分证据的不完整 Score", async () => {
  const runId = Schema.decodeUnknownSync(RunIdSchema)("source-run");
  const experimentId = Schema.decodeUnknownSync(ExperimentIdSchema)("current");
  const expected = Schema.decodeUnknownSync(RecordSlotIdentitySchema)({
    slotId: "score-slot", evalId: "score", attemptOrdinal: 0,
    executionIdentityDigest: "a".repeat(64),
  });
  const document = Schema.decodeUnknownSync(AttemptDocumentSchema)({
    attemptId: "score-attempt", originRunId: runId, slotId: expected.slotId,
    evalId: expected.evalId, executionIdentityDigest: expected.executionIdentityDigest,
    outcome: "completed",
  });
  const common = {
    display: { groupPath: [] },
    criterion: { state: "unavailable", reason: "not-recorded" },
    materials: { source: { kind: "unavailable", reason: "not-recorded" }, evidence: [], coverage: { state: "complete" }, limitations: [] },
    evaluation: { kind: "ordinary", observed: { kind: "unavailable", reason: "not-recorded" } },
    policy: { requirement: { state: "available", value: "required" }, condition: { state: "available", value: { kind: "record-only" } } },
    explanationRetention: { state: "unavailable", reason: "not-recorded" },
  } as const;
  const assertions: AssertionsAttachment = {
    sourceSites: [],
    entries: [{
      ...common,
      entryId: Schema.decodeUnknownSync(AssertionEntryIdSchema)("ae_00000000000000000000"),
      decision: { result: "matched", reason: null, gate: "not-gate" },
      contribution: { state: "earned", points: 2, earned: 2 },
    }, {
      ...common,
      entryId: Schema.decodeUnknownSync(AssertionEntryIdSchema)("ae_00000000000000000001"),
      decision: { result: "not-applicable", reason: "coverage-not-applicable", gate: "not-gate" },
      contribution: { state: "unavailable", points: 50, reason: "not-applicable" },
    }],
  };
  const source: CurrentAssessmentRun<number> = {
    createdRevision: 1,
    document: { runId, experimentId, startedAt: Schema.decodeUnknownSync(UtcMillisSchema)(0), expectedSlots: [expected] },
    members: [{ document: { slotId: expected.slotId, action: "executed", attempt: { originRunId: runId, attemptId: document.attemptId } }, attempt: 0 }],
  };
  const target: CurrentTargetSlot = {
    experimentId, evalId: expected.evalId, attempt: 0, evaluationKind: "score",
    executionIdentityDigest: expected.executionIdentityDigest,
    inputIdentity: { domain: "input", value: "current" },
    configIdentity: { domain: "config", value: "current" },
  };
  const assessed = await Effect.runPromise(assessCurrentTargetSlot({
    target,
    policy: { identity: projectTargetPolicyIdentity, reuseContract: { domain: "reuse", value: "current" }, rerun: "none", keepSandbox: false },
    runs: [source], byRunId: new Map([[runId, source]]), selectionHasProblem: false, coreIssues: [],
    readAttempt: () => Effect.succeed({ state: "available" as const, value: { document, publicationAvailable: true } }),
    readAssertions: () => Effect.succeed({ state: "available" as const, value: assertions }),
    readActivities: () => Effect.succeed({ state: "not-recorded" as const }),
    sourceFor: (_attempt, sourceBarrier) => ({ attemptId: document.attemptId, origin: { runId, slotId: expected.slotId }, sourceBarrier }),
  }));
  expect(assessed).toMatchObject({ state: "gap", reason: "score-incomplete", scope: "slot", sourceBarrier: { runId } });
});
