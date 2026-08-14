import { randomBytes } from "node:crypto";

import { Effect, Either, Schema } from "effect";
import {
  assertionsAttachmentDefinitionV1,
  createAssertionsAttachmentProducerV1,
  encodeAssertionResultV1,
  encodeSealedAssertionEntryV1,
} from "../../assertions/record/attachment.ts";
import {
  agentWorkspaceDiffAttachmentDefinitionV1,
  createAgentWorkspaceDiffAttachmentWriteV1,
} from "../../assertions/record/diff.ts";
import type {
  SealedAssertionEvaluation,
  SealedAttemptAssertions,
} from "../../assertions/api.ts";
import type { AssertionsProducerErrorV1 } from "../../assertions/record/producer.ts";
import type {
  AgentWorkspaceDiffDocumentV1,
} from "../../assertions/record/diff-model.ts";
import type {
  AssertionsDocumentOuterV1,
  SealedAssertionResultV1,
} from "../../assertions/record/model.ts";
import {
  recordAttachmentWriteContents,
} from "../../record/attachment/internal.ts";
import type {
  RecordAttachmentClosureInvalid,
  RecordAttachmentWrite,
  RecordBlobRef,
} from "../../record/attachment/index.ts";
import type { SlotId, UtcMillis } from "../../record/model/identifiers.ts";
import type { FrozenRecordAttempt } from "../../record/reader/types.ts";
import type {
  RecordPublishReceipt,
  RecordAttemptDraft,
  RecordRunDraft,
  RecordWriteError,
  RecordWriteSession,
} from "../../record/writer/types.ts";
import {
  ExactRecordAttachmentParseOptions,
} from "./attachment.ts";
import {
  validateEvaluationRecordCoherenceV1,
  type EvaluationRecordCoherenceIssueV1,
} from "./coherence.ts";
import {
  buildEvaluationsAttachmentWriteV1,
  buildEvaluationsPayloadV1,
  type EvaluationsPayloadBuildErrorV1,
  type EvaluationsPayloadV1,
} from "./evaluation.ts";
import {
  EvaluationAttemptFactsV1Schema,
  type EvaluationAttemptFactsV1,
} from "./sealed-assertion.ts";
import {
  createScoreAttachmentWriteV1,
  decodeScorePayloadV1,
  type ScorePayloadV1,
  ScorePayloadV1Schema,
} from "./score.ts";
import {
  createVerdictAttachmentWriteV1,
  decodeVerdictPayloadV1,
  type VerdictPayloadV1,
  VerdictPayloadV1Schema,
} from "./verdict.ts";

/**
 * A completed origin's producer facts. The Assertions write is intentionally
 * separate from generic Attempt writes: it is the durable peer of `facts` and
 * is verified as the built-in Assertions v1 Attachment before a plan exists.
 */
export interface EvaluationRecordOriginAttemptInputV1<
  Error = never,
  Requirements = never,
> {
  readonly slotId: SlotId;
  readonly facts: EvaluationAttemptFactsV1;
  readonly assertions: RecordAttachmentWrite<"attempt", Error, Requirements>;
  readonly verdict: VerdictPayloadV1;
  readonly score?: ScorePayloadV1;
  /** Domain-neutral Attempt Attachments already constructed by their owner. */
  readonly writes?: readonly RecordAttachmentWrite<
    "attempt",
    Error,
    Requirements
  >[];
}

/**
 * Runtime assertions reach durable storage only here. This adapter owns both
 * entry-ID allocation and the v1 Attachment codecs; Runner keeps only the
 * schema-independent sealed value.
 */
export type SealedAssertionsOriginEncodingError =
  | {
      readonly code: "assertions-attachment-invalid";
      readonly issue: AssertionsProducerErrorV1;
    }
  | {
      readonly code: "sealed-verdict-payload-invalid";
      readonly message: string;
    }
  | {
      readonly code: "sealed-score-payload-invalid";
      readonly message: string;
    }
  | {
      readonly code: "workspace-diff-attachment-invalid";
      readonly message: string;
    };

function assertionEntryId(): string {
  return `ae_${randomBytes(10).toString("hex")}`;
}

function evaluationFactsFromSealedAssertions(
  evaluation: SealedAssertionEvaluation,
): EvaluationAttemptFactsV1 {
  return Object.freeze({
    execution: evaluation.execution,
    explicitlySkipped: evaluation.explicitlySkipped,
    assertions: Object.freeze(evaluation.assertions.map((assertion) => Object.freeze({
      required: assertion.required,
      result: encodeAssertionResultV1(assertion.result),
    }))),
  });
}

function encodingErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The runtime fold is already frozen at seal time. The Record boundary maps it
 * into the exact durable shape, then leaves facts-vs-payload agreement to the
 * independent Evaluation Record coherence check.
 */
function encodeSealedVerdictPayload(
  verdict: SealedAttemptAssertions["verdict"],
): Either.Either<VerdictPayloadV1, SealedAssertionsOriginEncodingError> {
  const decoded = Schema.decodeUnknownEither(
    VerdictPayloadV1Schema,
    ExactRecordAttachmentParseOptions,
  )(Object.freeze({ state: verdict.state }));
  return Either.isLeft(decoded)
    ? Either.left(Object.freeze({
        code: "sealed-verdict-payload-invalid" as const,
        message: encodingErrorMessage(decoded.left),
      }))
    : Either.right(decoded.right);
}

function encodeSealedScorePayload(
  score: NonNullable<SealedAttemptAssertions["score"]>,
): Either.Either<ScorePayloadV1, SealedAssertionsOriginEncodingError> {
  const candidate = (() => {
    switch (score.state) {
      case "complete":
        return Object.freeze({
          state: "complete" as const,
          earned: score.earned,
        });
      case "partial":
        return Object.freeze({
          state: "partial" as const,
          earned: score.earned,
          reasons: Object.freeze([...score.reasons]),
        });
      case "unavailable":
        return Object.freeze({
          state: "unavailable" as const,
          reasons: Object.freeze([...score.reasons]),
        });
    }
  })();
  const decoded = Schema.decodeUnknownEither(
    ScorePayloadV1Schema,
    ExactRecordAttachmentParseOptions,
  )(candidate);
  return Either.isLeft(decoded)
    ? Either.left(Object.freeze({
        code: "sealed-score-payload-invalid" as const,
        message: encodingErrorMessage(decoded.left),
      }))
    : Either.right(decoded.right);
}

/**
 * Encodes an already sealed runtime value at the Evaluation Record boundary.
 * No author/runtime or Runner module receives an Attachment write or durable
 * document while constructing the semantic attempt result.
 */
export function evaluationRecordOriginInputFromSealedAssertions(
  slotId: SlotId,
  sealed: SealedAttemptAssertions,
): Either.Either<
  EvaluationRecordOriginAttemptInputV1,
  SealedAssertionsOriginEncodingError
> {
  const producer = createAssertionsAttachmentProducerV1<never, never>({
    entryIds: { next: assertionEntryId },
  });
  for (const entry of sealed.entries) {
    const appended = producer.append(encodeSealedAssertionEntryV1(entry));
    if (Either.isLeft(appended)) {
      return Either.left(Object.freeze({
        code: "assertions-attachment-invalid" as const,
        issue: appended.left,
      }));
    }
  }
  const assertions = producer.seal();
  if (Either.isLeft(assertions)) {
    return Either.left(Object.freeze({
      code: "assertions-attachment-invalid" as const,
      issue: assertions.left,
    }));
  }

  const facts = evaluationFactsFromSealedAssertions(sealed.evaluation);
  const verdict = encodeSealedVerdictPayload(sealed.verdict);
  if (Either.isLeft(verdict)) return Either.left(verdict.left);

  let score: ScorePayloadV1 | undefined;
  if (sealed.score !== undefined) {
    const encodedScore = encodeSealedScorePayload(sealed.score);
    if (Either.isLeft(encodedScore)) return Either.left(encodedScore.left);
    score = encodedScore.right;
  }

  let writes: readonly RecordAttachmentWrite<"attempt", never, never>[] = Object.freeze([]);
  if (sealed.workspaceDiff !== undefined) {
    try {
      writes = Object.freeze([
        createAgentWorkspaceDiffAttachmentWriteV1(sealed.workspaceDiff),
      ]);
    } catch (error) {
      return Either.left(Object.freeze({
        code: "workspace-diff-attachment-invalid" as const,
        message: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  return Either.right(Object.freeze({
    slotId,
    facts,
    assertions: assertions.right,
    verdict: verdict.right,
    ...(score === undefined ? {} : { score }),
    ...(writes.length === 0 ? {} : { writes }),
  }));
}

/** A reference Member explicitly carries the exact frozen source capability. */
export interface EvaluationRecordReferenceInputV1 {
  readonly slotId: SlotId;
  readonly attempt: FrozenRecordAttempt;
}

/**
 * Input to the Evaluation producer's one-Run contract. Extra writes retain
 * their owner-specific payload and closure authority. The generic writer
 * consumes those already-constructed typed writes without learning their
 * business names.
 */
export interface EvaluationRecordPlanInputV1<
  Error = never,
  Requirements = never,
> {
  readonly startedAt: UtcMillis;
  readonly completedAt: UtcMillis;
  readonly expectedSlots: readonly SlotId[];
  readonly evaluations: EvaluationsPayloadV1;
  readonly originAttempts: readonly EvaluationRecordOriginAttemptInputV1<
    Error,
    Requirements
  >[];
  readonly references?: readonly EvaluationRecordReferenceInputV1[];
  /** Domain-neutral Run Attachments already constructed by their owner. */
  readonly runWrites?: readonly RecordAttachmentWrite<
    "run",
    Error,
    Requirements
  >[];
}

export type EvaluationRecordContractIssueV1 =
  | {
      readonly code: "evaluation-record-evaluations-build-invalid";
      readonly issue: EvaluationsPayloadBuildErrorV1;
    }
  | {
      readonly code: "evaluation-record-attempt-facts-invalid";
      readonly slotId: SlotId;
    }
  | {
      readonly code: "evaluation-record-assertions-write-invalid";
      readonly slotId: SlotId;
      readonly reason:
        | "closure-invalid"
        | "definition-invalid"
        | "facts-mismatch"
        | "record-attachment-reference-missing"
        | "record-attachment-coverage-incoherent";
      readonly issue?: RecordAttachmentClosureInvalid;
    }
  | {
      readonly code: "evaluation-record-verdict-payload-invalid";
      readonly slotId: SlotId;
    }
  | {
      readonly code: "evaluation-record-score-payload-invalid";
      readonly slotId: SlotId;
    }
  | {
      readonly code: "evaluation-record-coherence-invalid";
      readonly issue: EvaluationRecordCoherenceIssueV1;
    }
  | {
      readonly code: "evaluation-record-reference-slot-unexpected";
      readonly slotId: SlotId;
    }
  | {
      readonly code: "evaluation-record-member-slot-duplicate";
      readonly slotId: SlotId;
    };

/** All Evaluation-domain invalidity is settled before a generic draft exists. */
export interface EvaluationRecordContractInvalidV1 {
  readonly code: "evaluation-record-contract-invalid";
  readonly issues: readonly EvaluationRecordContractIssueV1[];
}

/** A copied object cannot be used in place of a package-created plan. */
export interface EvaluationRecordPlanInvalidV1 {
  readonly code: "evaluation-record-plan-invalid";
}

/** A pre-created origin draft did not match the plan's exact Slot. */
export interface EvaluationRecordOriginDraftMissingV1 {
  readonly code: "evaluation-record-origin-draft-missing";
  readonly slotId: SlotId;
}

const evaluationRecordPlanBrand: unique symbol = Symbol(
  "@niceeval/eval/EvaluationRecordPlanV1",
);

/**
 * Opaque result of a successful EvaluationRecordContractV1 preflight. Its
 * operational contents live in a private WeakMap, not on the public object.
 */
export interface EvaluationRecordPlanV1<Error = never, Requirements = never> {
  readonly [evaluationRecordPlanBrand]: () => void;
}

interface PreparedOriginAttemptV1<Error, Requirements> {
  readonly slotId: SlotId;
  readonly facts: EvaluationAttemptFactsV1;
  readonly assertions: RecordAttachmentWrite<"attempt", Error, Requirements>;
  readonly verdict: VerdictPayloadV1;
  readonly score: ScorePayloadV1 | undefined;
  readonly writes: readonly RecordAttachmentWrite<"attempt", Error, Requirements>[];
}

interface PlannedOriginAttemptV1<Error, Requirements> {
  readonly slotId: SlotId;
  readonly assertions: RecordAttachmentWrite<"attempt", Error, Requirements>;
  readonly verdict: RecordAttachmentWrite<"attempt", never, never>;
  readonly score: RecordAttachmentWrite<"attempt", never, never> | undefined;
  readonly additionalWrites: readonly RecordAttachmentWrite<
    "attempt",
    Error,
    Requirements
  >[];
}

interface EvaluationRecordPlanRuntimeV1<Error, Requirements> {
  readonly startedAt: UtcMillis;
  readonly completedAt: UtcMillis;
  readonly expectedSlots: readonly SlotId[];
  readonly runWrites: readonly RecordAttachmentWrite<"run", Error, Requirements>[];
  readonly originAttempts: readonly PlannedOriginAttemptV1<Error, Requirements>[];
  readonly references: readonly EvaluationRecordReferenceInputV1[];
}

const planRuntimes = new WeakMap<object, unknown>();

function freezeArray<Value>(values: readonly Value[]): readonly Value[] {
  return Object.freeze([...values]);
}

function contractInvalid(
  issues: readonly EvaluationRecordContractIssueV1[],
): EvaluationRecordContractInvalidV1 {
  return Object.freeze({
    code: "evaluation-record-contract-invalid" as const,
    issues: freezeArray(issues),
  });
}

function planInvalid(): EvaluationRecordPlanInvalidV1 {
  return Object.freeze({ code: "evaluation-record-plan-invalid" as const });
}

function sameScoreContribution(
  left: SealedAssertionResultV1["score"],
  right: SealedAssertionResultV1["score"],
): boolean {
  if (left.state !== right.state) return false;
  switch (left.state) {
    case "not-scored":
      return true;
    case "earned":
      return right.state === "earned"
        && left.points === right.points
        && left.earned === right.earned;
    case "unavailable":
      return right.state === "unavailable"
        && left.points === right.points
        && left.reason === right.reason;
  }
}

function sameSealedAssertionResult(
  left: SealedAssertionResultV1,
  right: SealedAssertionResultV1,
): boolean {
  if (left.state !== right.state || left.gate !== right.gate) return false;
  if (!sameScoreContribution(left.score, right.score)) return false;
  switch (left.state) {
    case "matched":
      return right.state === "matched";
    case "mismatched":
      return right.state === "mismatched" && left.reason === right.reason;
    case "unavailable":
      return right.state === "unavailable" && left.reason === right.reason;
    case "errored":
      return right.state === "errored" && left.reason === right.reason;
    case "not-applicable":
      return right.state === "not-applicable" && left.reason === right.reason;
  }
}

function assertionsMatchFacts(
  document: AssertionsDocumentOuterV1<RecordBlobRef>,
  facts: EvaluationAttemptFactsV1,
): boolean {
  return document.entries.length === facts.assertions.length
    && document.entries.every((entry, index) => {
      const assertion = facts.assertions[index];
      return assertion !== undefined
        && sameSealedAssertionResult(entry.result, assertion.result);
    });
}

function hasWorkspaceDiffReference(
  document: AssertionsDocumentOuterV1<RecordBlobRef>,
): boolean {
  const isReference = (material: (typeof document.entries)[number]["subject"]): boolean =>
    material.kind === "record-attachment" && material.schemaId === "niceeval.diff/v1";
  return document.entries.some((entry) =>
    isReference(entry.subject) || entry.evidence.some(isReference));
}

function workspaceDiffDocuments<Error, Requirements>(
  writes: readonly RecordAttachmentWrite<"attempt", Error, Requirements>[],
): readonly AgentWorkspaceDiffDocumentV1[] {
  const documents: AgentWorkspaceDiffDocumentV1[] = [];
  for (const write of writes) {
    const contents = recordAttachmentWriteContents<
      "attempt",
      AgentWorkspaceDiffDocumentV1,
      Error,
      Requirements
    >(write);
    if (
      Either.isRight(contents)
      && contents.right.definition === agentWorkspaceDiffAttachmentDefinitionV1
    ) {
      documents.push(contents.right.payload);
    }
  }
  return Object.freeze(documents);
}

function hasCoherentWorkspaceDiffCoverage(
  document: AssertionsDocumentOuterV1<RecordBlobRef>,
  facts: EvaluationAttemptFactsV1,
  documents: readonly AgentWorkspaceDiffDocumentV1[],
): boolean {
  const hasSingleWrite = documents.length === 1;
  for (const [index, entry] of document.entries.entries()) {
    const referencesDiff = entry.subject.kind === "record-attachment"
      && entry.subject.schemaId === "niceeval.diff/v1"
      || entry.evidence.some(
        (material) => material.kind === "record-attachment"
          && material.schemaId === "niceeval.diff/v1",
      );
    if (!referencesDiff) continue;
    const determined = entry.result.state === "matched" || entry.result.state === "mismatched";
    if (determined && (!hasSingleWrite || entry.coverage.state === "unavailable")) return false;
    // Required references must name the same Attempt's actual write. Optional
    // unavailable observations can remain durable facts without independently
    // blocking the Verdict when collection never produced an Attachment.
    if (facts.assertions[index]?.required === true && !hasSingleWrite) return false;
  }
  return true;
}

function decodeFacts(
  facts: EvaluationAttemptFactsV1,
): Either.Either<EvaluationAttemptFactsV1, "invalid"> {
  const decoded = Schema.decodeUnknownEither(
    EvaluationAttemptFactsV1Schema,
    ExactRecordAttachmentParseOptions,
  )(facts);
  return Either.isLeft(decoded)
    ? Either.left("invalid")
    : Either.right(decoded.right);
}

function validateAssertionsWrite<Error, Requirements>(input: {
  readonly slotId: SlotId;
  readonly facts: EvaluationAttemptFactsV1;
  readonly write: RecordAttachmentWrite<"attempt", Error, Requirements>;
  readonly writes: readonly RecordAttachmentWrite<"attempt", Error, Requirements>[];
}): EvaluationRecordContractIssueV1 | undefined {
  const contents = recordAttachmentWriteContents<
    "attempt",
    AssertionsDocumentOuterV1<RecordBlobRef>,
    Error,
    Requirements
  >(input.write);
  if (Either.isLeft(contents)) {
    return Object.freeze({
      code: "evaluation-record-assertions-write-invalid" as const,
      slotId: input.slotId,
      reason: "closure-invalid" as const,
      issue: contents.left,
    });
  }
  if (contents.right.definition !== assertionsAttachmentDefinitionV1) {
    return Object.freeze({
      code: "evaluation-record-assertions-write-invalid" as const,
      slotId: input.slotId,
      reason: "definition-invalid" as const,
    });
  }
  if (!assertionsMatchFacts(contents.right.payload, input.facts)) {
    return Object.freeze({
      code: "evaluation-record-assertions-write-invalid" as const,
      slotId: input.slotId,
      reason: "facts-mismatch" as const,
    });
  }
  const referencesDiff = hasWorkspaceDiffReference(contents.right.payload);
  const documents = workspaceDiffDocuments(input.writes);
  if (referencesDiff && !hasCoherentWorkspaceDiffCoverage(contents.right.payload, input.facts, documents)) {
    return Object.freeze({
      code: "evaluation-record-assertions-write-invalid" as const,
      slotId: input.slotId,
      reason: documents.length === 1
        ? "record-attachment-coverage-incoherent" as const
        : "record-attachment-reference-missing" as const,
    });
  }
  return undefined;
}

function planRuntime<Error, Requirements>(
  plan: EvaluationRecordPlanV1<Error, Requirements>,
): EvaluationRecordPlanRuntimeV1<Error, Requirements> | undefined {
  const runtime = planRuntimes.get(plan);
  return runtime === undefined
    ? undefined
    : runtime as EvaluationRecordPlanRuntimeV1<Error, Requirements>;
}

/**
 * Validates the Evaluation aggregate and captures generated domain writes plus
 * already-constructed owner writes into an opaque plan. This is pure: it opens
 * no writer and creates no Run directory.
 */
export function createEvaluationRecordPlanV1<Error, Requirements>(
  input: EvaluationRecordPlanInputV1<Error, Requirements>,
): Either.Either<
  EvaluationRecordPlanV1<Error, Requirements>,
  EvaluationRecordContractInvalidV1
> {
  const issues: EvaluationRecordContractIssueV1[] = [];
  const builtEvaluations = buildEvaluationsPayloadV1(input.evaluations);
  if (Either.isLeft(builtEvaluations)) {
    issues.push(
      Object.freeze({
        code: "evaluation-record-evaluations-build-invalid" as const,
        issue: builtEvaluations.left,
      }),
    );
    return Either.left(contractInvalid(issues));
  }

  const evaluationsWrite = buildEvaluationsAttachmentWriteV1(
    builtEvaluations.right,
  );
  if (Either.isLeft(evaluationsWrite)) {
    issues.push(
      Object.freeze({
        code: "evaluation-record-evaluations-build-invalid" as const,
        issue: evaluationsWrite.left,
      }),
    );
    return Either.left(contractInvalid(issues));
  }

  const preparedAttempts: PreparedOriginAttemptV1<Error, Requirements>[] = [];
  for (const origin of input.originAttempts) {
    const facts = decodeFacts(origin.facts);
    if (Either.isLeft(facts)) {
      issues.push(
        Object.freeze({
          code: "evaluation-record-attempt-facts-invalid" as const,
          slotId: origin.slotId,
        }),
      );
      continue;
    }

    const verdict = decodeVerdictPayloadV1(origin.verdict);
    if (Either.isLeft(verdict)) {
      issues.push(
        Object.freeze({
          code: "evaluation-record-verdict-payload-invalid" as const,
          slotId: origin.slotId,
        }),
      );
      continue;
    }

    const score = origin.score === undefined
      ? undefined
      : decodeScorePayloadV1(origin.score);
    if (score !== undefined && Either.isLeft(score)) {
      issues.push(
        Object.freeze({
          code: "evaluation-record-score-payload-invalid" as const,
          slotId: origin.slotId,
        }),
      );
      continue;
    }

    const assertionsIssue = validateAssertionsWrite({
      slotId: origin.slotId,
      facts: facts.right,
      write: origin.assertions,
      writes: origin.writes ?? [],
    });
    if (assertionsIssue !== undefined) {
      issues.push(assertionsIssue);
      continue;
    }

    preparedAttempts.push(
      Object.freeze({
        slotId: origin.slotId,
        facts: facts.right,
        assertions: origin.assertions,
        verdict: verdict.right,
        score: score === undefined ? undefined : score.right,
        writes: freezeArray(origin.writes ?? []),
      }),
    );
  }

  if (issues.length > 0) return Either.left(contractInvalid(issues));

  for (const issue of validateEvaluationRecordCoherenceV1({
    expectedSlots: input.expectedSlots,
    evaluations: builtEvaluations.right,
    attempts: preparedAttempts.map((attempt) =>
      Object.freeze({
        slotId: attempt.slotId,
        facts: attempt.facts,
        verdict: attempt.verdict,
        ...(attempt.score === undefined ? {} : { score: attempt.score }),
      })),
  })) {
    issues.push(
      Object.freeze({
        code: "evaluation-record-coherence-invalid" as const,
        issue,
      }),
    );
  }
  if (issues.length > 0) return Either.left(contractInvalid(issues));

  const plannedOrigins: PlannedOriginAttemptV1<Error, Requirements>[] = [];
  for (const origin of preparedAttempts) {
    const verdictWrite = createVerdictAttachmentWriteV1(origin.verdict);
    const scoreWrite = origin.score === undefined
      ? undefined
      : createScoreAttachmentWriteV1(origin.score);
    plannedOrigins.push(
      Object.freeze({
        slotId: origin.slotId,
        assertions: origin.assertions,
        verdict: verdictWrite,
        score: scoreWrite,
        additionalWrites: origin.writes,
      }),
    );
  }
  if (issues.length > 0) return Either.left(contractInvalid(issues));

  const expectedSlots = new Set<string>(input.expectedSlots);
  const memberSlots = new Set<string>(preparedAttempts.map((attempt) => attempt.slotId));
  const references: EvaluationRecordReferenceInputV1[] = [];
  for (const reference of input.references ?? []) {
    if (!expectedSlots.has(reference.slotId)) {
      issues.push(
        Object.freeze({
          code: "evaluation-record-reference-slot-unexpected" as const,
          slotId: reference.slotId,
        }),
      );
      continue;
    }
    if (memberSlots.has(reference.slotId)) {
      issues.push(
        Object.freeze({
          code: "evaluation-record-member-slot-duplicate" as const,
          slotId: reference.slotId,
        }),
      );
      continue;
    }
    memberSlots.add(reference.slotId);
    references.push(
      Object.freeze({ slotId: reference.slotId, attempt: reference.attempt }),
    );
  }

  if (issues.length > 0) return Either.left(contractInvalid(issues));

  const plan: EvaluationRecordPlanV1<Error, Requirements> = Object.freeze({
    [evaluationRecordPlanBrand]: () => undefined,
  });
  const runtime: EvaluationRecordPlanRuntimeV1<Error, Requirements> =
    Object.freeze({
      startedAt: input.startedAt,
      completedAt: input.completedAt,
      expectedSlots: freezeArray(input.expectedSlots),
      runWrites: freezeArray([evaluationsWrite.right, ...(input.runWrites ?? [])]),
      originAttempts: freezeArray(plannedOrigins),
      references: freezeArray(references),
    });
  planRuntimes.set(plan, runtime);
  return Either.right(plan);
}

/** Effect form for callers that compose preflight directly into a producer flow. */
export function prepareEvaluationRecordPlanV1<Error, Requirements>(
  input: EvaluationRecordPlanInputV1<Error, Requirements>,
): Effect.Effect<
  EvaluationRecordPlanV1<Error, Requirements>,
  EvaluationRecordContractInvalidV1
> {
  return Effect.suspend(() => {
    const plan = createEvaluationRecordPlanV1(input);
    return Either.isLeft(plan) ? Effect.fail(plan.left) : Effect.succeed(plan.right);
  });
}

/**
 * Consumes a package-created plan through the generic Record writer. No domain
 * fold or raw Attachment construction remains on this path, and interruption
 * is deliberately left to the writer's normal incomplete-draft semantics.
 */
export function writeEvaluationRecordPlanV1<Error, Requirements>(
  session: RecordWriteSession,
  plan: EvaluationRecordPlanV1<Error, Requirements>,
): Effect.Effect<
  RecordPublishReceipt,
  | EvaluationRecordPlanInvalidV1
  | EvaluationRecordOriginDraftMissingV1
  | RecordWriteError
  | Error,
  Requirements
> {
  return Effect.suspend<
    RecordPublishReceipt,
    | EvaluationRecordPlanInvalidV1
    | EvaluationRecordOriginDraftMissingV1
    | RecordWriteError
    | Error,
    Requirements
  >(() => {
    const runtime = planRuntime(plan);
    if (runtime === undefined) return Effect.fail(planInvalid());
    return Effect.gen(function* () {
      const draft = yield* session.createRun({
        startedAt: runtime.startedAt,
        expectedSlots: runtime.expectedSlots,
      });
      return yield* writeEvaluationRecordPlanToDraftV1(draft, plan);
    });
  });
}

/**
 * Applies an already-validated Evaluation plan to a draft created before
 * expensive execution begins. The Runner uses this to leave an incomplete
 * directory behind on interruption while keeping the Evaluation contract as
 * the only path that turns sealed facts into generic Record mutations.
 */
export function writeEvaluationRecordPlanToDraftV1<Error, Requirements>(
  draft: RecordRunDraft,
  plan: EvaluationRecordPlanV1<Error, Requirements>,
): Effect.Effect<
  RecordPublishReceipt,
  | EvaluationRecordPlanInvalidV1
  | EvaluationRecordOriginDraftMissingV1
  | RecordWriteError
  | Error,
  Requirements
> {
  return Effect.suspend<
    RecordPublishReceipt,
    | EvaluationRecordPlanInvalidV1
    | EvaluationRecordOriginDraftMissingV1
    | RecordWriteError
    | Error,
    Requirements
  >(() => {
    const runtime = planRuntime(plan);
    if (runtime === undefined) return Effect.fail(planInvalid());
    return Effect.gen(function* () {
      yield* writeEvaluationRecordPlanRunToDraftV1(draft, plan);
      const attempts = new Map<SlotId, RecordAttemptDraft>();
      for (const origin of runtime.originAttempts) {
        const attempt = yield* draft.createAttempt({ slotId: origin.slotId });
        attempts.set(origin.slotId, attempt);
      }
      yield* writeEvaluationRecordPlanOriginsToAttemptsV1(attempts, plan);
      yield* writeEvaluationRecordPlanReferencesToDraftV1(draft, plan);
      return yield* draft.publish({ completedAt: runtime.completedAt });
    });
  });
}

/**
 * Writes only the Run-owned portion of a validated Evaluation plan. This is
 * intentionally narrow: a Runner can establish the denominator and linked
 * Run attachments before dispatch without creating an Attempt for an
 * unstarted Slot.
 */
export function writeEvaluationRecordPlanRunToDraftV1<Error, Requirements>(
  draft: RecordRunDraft,
  plan: EvaluationRecordPlanV1<Error, Requirements>,
): Effect.Effect<
  void,
  EvaluationRecordPlanInvalidV1 | RecordWriteError | Error,
  Requirements
> {
  return Effect.suspend<
    void,
    EvaluationRecordPlanInvalidV1 | RecordWriteError | Error,
    Requirements
  >(() => {
    const runtime = planRuntime(plan);
    if (runtime === undefined) return Effect.fail(planInvalid());
    return Effect.forEach(runtime.runWrites, (write) => draft.record(write), {
      discard: true,
    });
  });
}

/**
 * Writes sealed origin facts into Attempts that were allocated at dispatch.
 * It never calls `createAttempt`: the caller must present the exact draft for
 * each Slot, which keeps the AttemptId used during execution identical to the
 * Member published later.
 */
export function writeEvaluationRecordPlanOriginsToAttemptsV1<
  Error,
  Requirements,
>(
  attempts: ReadonlyMap<SlotId, RecordAttemptDraft>,
  plan: EvaluationRecordPlanV1<Error, Requirements>,
): Effect.Effect<
  void,
  | EvaluationRecordPlanInvalidV1
  | EvaluationRecordOriginDraftMissingV1
  | RecordWriteError
  | Error,
  Requirements
> {
  return Effect.suspend<
    void,
    | EvaluationRecordPlanInvalidV1
    | EvaluationRecordOriginDraftMissingV1
    | RecordWriteError
    | Error,
    Requirements
  >(() => {
    const runtime = planRuntime(plan);
    if (runtime === undefined) return Effect.fail(planInvalid());
    return Effect.gen(function* () {
      for (const origin of runtime.originAttempts) {
        const attempt = attempts.get(origin.slotId);
        if (attempt === undefined) {
          return yield* Effect.fail<EvaluationRecordOriginDraftMissingV1>({
            code: "evaluation-record-origin-draft-missing",
            slotId: origin.slotId,
          });
        }
        yield* attempt.record(origin.assertions);
        yield* attempt.record(origin.verdict);
        if (origin.score !== undefined) yield* attempt.record(origin.score);
        for (const write of origin.additionalWrites) yield* attempt.record(write);
      }
    });
  });
}

/** Writes only exact reference Members already validated by the opaque plan. */
export function writeEvaluationRecordPlanReferencesToDraftV1<
  Error,
  Requirements,
>(
  draft: RecordRunDraft,
  plan: EvaluationRecordPlanV1<Error, Requirements>,
): Effect.Effect<
  void,
  EvaluationRecordPlanInvalidV1 | RecordWriteError,
  never
> {
  return Effect.suspend<
    void,
    EvaluationRecordPlanInvalidV1 | RecordWriteError,
    never
  >(() => {
    const runtime = planRuntime(plan);
    if (runtime === undefined) return Effect.fail(planInvalid());
    return Effect.forEach(runtime.references, (reference) => draft.reference(reference), {
      discard: true,
    });
  });
}

/** The internal Evaluation-specific contract, not a generic Record abstraction. */
export const EvaluationRecordContractV1 = Object.freeze({
  createPlan: createEvaluationRecordPlanV1,
  preparePlan: prepareEvaluationRecordPlanV1,
  writePlan: writeEvaluationRecordPlanV1,
  writePlanToDraft: writeEvaluationRecordPlanToDraftV1,
  writePlanRunToDraft: writeEvaluationRecordPlanRunToDraftV1,
  writePlanOriginsToAttempts: writeEvaluationRecordPlanOriginsToAttemptsV1,
  writePlanReferencesToDraft: writeEvaluationRecordPlanReferencesToDraftV1,
});
