import { Data, Effect, Result } from "effect";

import { encodeAttemptLocator } from "../attempt-locator.ts";
import { foldRecordedAttemptVerdict } from "../eval/record/verdict.ts";
import {
  mintRecordContentHandle,
  type RecordContentHandle,
} from "../record/attachment/content.ts";
import {
  enumerateRecordAttachmentClosure,
  hydrateRecordAttachmentCurrent,
  mintRecordAttachmentReference,
  RecordAttachmentReference,
  recordAttachmentReferenceWire,
} from "../record/attachment/protocol.ts";
import {
  NiceEvalRecordAttachmentCatalog,
  NiceEvalRecordAttachments,
} from "../record/family/catalog.ts";
import {
  decodeAttemptDocument,
  decodeMemberDocument,
  decodeRunDocument,
} from "../record/codec/index.ts";
import type { AttemptDocument, MemberDocument, RunDocument } from "../record/model/core.ts";
import type {
  SealedAttachmentMetadata,
  SealedRunCore,
  SealedRunCutoff,
  SealedRunSummary,
  SealedRunSummaryPage,
} from "../record/sqlite/index.ts";
import { inspectionBehaviorVersion, inspectionOperationCatalog } from "./catalog.ts";
import {
  QUERY_PROTOCOL,
  closeInspectionJson,
  type InspectionDocument,
  type InspectionJson,
  type InspectionOperation,
  type InspectionOperationId,
  type InspectionRequest,
} from "./codec.ts";
import { INSPECTION_RESULT_BYTE_LIMIT } from "./limits.ts";
import type { InspectionFactSource, OpenInspectionSource } from "./source.ts";
import { projectAttemptSources } from "./sources.ts";
import { projectAttemptTrace } from "./trace.ts";

export class InspectionHostError extends Data.TaggedError("InspectionHostError")<{
  readonly code:
    | "inspection-request-invalid"
    | "inspection-selection-missing"
    | "inspection-operation-failed";
  readonly operation: InspectionOperationId | "discover";
  readonly reason: string;
  readonly cause?: unknown;
}> {}

export type InspectionHostRequirements = never;

export interface InspectionDiscovery {
  readonly protocol: typeof QUERY_PROTOCOL;
  readonly operations: typeof inspectionOperationCatalog;
}

export interface InspectionHostSDK {
  readonly discover: () => InspectionDiscovery;
  readonly explain: (
    source: OpenInspectionSource,
    request: InspectionRequest,
  ) => Effect.Effect<InspectionDocument, InspectionHostError>;
  readonly run: (
    source: OpenInspectionSource,
    request: InspectionRequest,
  ) => Effect.Effect<InspectionDocument, InspectionHostError>;
}

interface DecodedAttachment {
  readonly physical: SealedAttachmentMetadata;
  readonly value: InspectionJson;
}

interface LoadedRun {
  readonly source: InspectionFactSource;
  readonly physical: SealedRunCore;
  readonly run: RunDocument;
  readonly members: readonly MemberDocument[];
  readonly attempts: readonly AttemptDocument[];
  readonly attachments: readonly DecodedAttachment[];
}

interface ResolvedAttempt {
  readonly attempt: AttemptDocument;
  readonly origin: LoadedRun;
  readonly locator: string;
  readonly targets: readonly { readonly run: LoadedRun; readonly member: MemberDocument }[];
}

const RUN_LIST_PAGE_SIZE = 100;
const ATTACHMENT_COLLECTION_PAGE_SIZE = 64;
const ATTACHMENT_CONTENT_METADATA_LIMIT = 64;
const RUN_SELECTION_LIMIT = 64;
const ATTEMPT_CANDIDATE_RUN_LIMIT = 64;
const ATTEMPT_TARGET_MEMBER_LIMIT = 256;
const CONTINUATION_PROTOCOL = "niceeval.query-continuation/v1";

export const inspectionHost: InspectionHostSDK = Object.freeze({
  discover: () => Object.freeze({ protocol: QUERY_PROTOCOL, operations: inspectionOperationCatalog }),
  explain: (source: OpenInspectionSource, request: InspectionRequest) => inspectEffect(request.operation.kind, () =>
    explainInspection(source.facts, request.operation)),
  run: (source: OpenInspectionSource, request: InspectionRequest) => inspectEffect(request.operation.kind, () =>
    runInspection(source.facts, request.operation)),
});

function inspectEffect<A>(
  operation: InspectionOperationId | "discover",
  evaluate: () => A,
): Effect.Effect<A, InspectionHostError> {
  return Effect.try({
    try: evaluate,
    catch: (cause) => cause instanceof InspectionHostError
      ? cause
      : hostFailure(operation, "Inspection operation failed", cause),
  });
}

function explainInspection(source: InspectionFactSource, operation: InspectionOperation): InspectionDocument {
  if (operation.kind === "runs.list") return runsListExplanation(source, operation);
  const loaded = loadForOperation(source, operation);
  return Object.freeze({
    ...baseDocument(source, operation.kind, loaded.selected, loaded.requestedRunIds, loaded.missingRunIds, []),
    factKinds: factKinds(operation.kind),
  });
}

function runInspection(source: InspectionFactSource, operation: InspectionOperation): InspectionDocument {
  switch (operation.kind) {
    case "runs.list": return runsListDocument(source, operation);
    case "run.get": {
      const selected = selectRuns(loadRuns(source, [operation.runId]), [operation.runId]);
      const run = requireOne(operation.kind, selected.selected, operation.runId);
      return Object.freeze({
        ...baseDocument(source, operation.kind, selected.selected, [operation.runId], selected.missing, locators(selected.selected)),
        run: boundedJson(Object.freeze({ value: run.run, members: run.members, attempts: run.attempts })),
      });
    }
    case "run.summary": {
      const selected = selectRuns(loadRuns(source, [operation.runId]), [operation.runId]);
      const run = requireOne(operation.kind, selected.selected, operation.runId);
      const all = loadSummaryFacts(source, run);
      return Object.freeze({
        ...baseDocument(source, operation.kind, all, [operation.runId], selected.missing, locators(all)),
        summary: boundedJson(runSummary(all, run)),
      });
    }
    case "attempt.get": {
      const resolved = requireAttemptFromSource(source, operation.kind, operation.locator);
      return Object.freeze({
        ...baseDocument(source, operation.kind, attemptRuns(resolved), [], [], [operation.locator]),
        attempt: boundedJson(attemptDetail(resolved)),
      });
    }
    case "attempt.trace": {
      const resolved = requireAttemptFromSource(source, operation.kind, operation.locator);
      return Object.freeze({
        ...baseDocument(source, operation.kind, attemptRuns(resolved), [], [], [operation.locator]),
        trace: boundedJson(projectAttemptTrace(resolved.origin.source, Object.freeze({
          agentTurns: attemptAttachment(resolved, NiceEvalRecordAttachments.agentTurns.family),
          turnContexts: attemptAttachment(resolved, NiceEvalRecordAttachments.turnContexts.family),
          sandboxCommands: attemptAttachment(resolved, NiceEvalRecordAttachments.sandboxCommands.family),
          runnerActivities: attemptAttachment(
            resolved,
            NiceEvalRecordAttachments.runnerActivities.attempt.family,
          ),
          runnerDiagnostics: attemptAttachment(
            resolved,
            NiceEvalRecordAttachments.runnerDiagnostics.attempt.family,
          ),
        }))),
      });
    }
    case "attempt.diff": {
      const resolved = requireAttemptFromSource(source, operation.kind, operation.locator);
      return Object.freeze({
        ...baseDocument(source, operation.kind, attemptRuns(resolved), [], [], [operation.locator]),
        diff: boundedJson(attachmentValue(resolved, NiceEvalRecordAttachments.fileChanges.family)),
      });
    }
    case "attempt.sources": {
      const resolved = requireAttemptFromSource(source, operation.kind, operation.locator);
      return Object.freeze({
        ...baseDocument(source, operation.kind, attemptRuns(resolved), [], [], [operation.locator]),
        sources: boundedJson(projectAttemptSources(
          resolved.origin.source,
          runAttachment(resolved.origin, NiceEvalRecordAttachments.sources.family),
          attemptAttachment(resolved, NiceEvalRecordAttachments.assertions.family),
        )),
      });
    }
    case "attempt.artifacts": {
      const resolved = requireAttemptFromSource(source, operation.kind, operation.locator);
      const attachment = attemptAttachment(resolved, NiceEvalRecordAttachments.artifacts.attempt.family);
      return Object.freeze({
        ...baseDocument(source, operation.kind, attemptRuns(resolved), [], [], [operation.locator]),
        artifacts: boundedJson(attachment === undefined
          ? Object.freeze({ state: "not-recorded" as const })
          : Object.freeze({
              state: "available" as const,
              value: attachment.value,
              collection: attachmentCollectionPage(resolved.origin.source, attachment),
              contents: attachment.physical.contents
                .slice(0, ATTACHMENT_CONTENT_METADATA_LIMIT)
                .map(({ logicalHandle, byteLength, digest }) =>
                  Object.freeze({ logicalHandle, byteLength, digest })),
              contentsTruncated: attachment.physical.contents.length > ATTACHMENT_CONTENT_METADATA_LIMIT,
            })),
      });
    }
    case "runs.compare": {
      const selected = loadRuns(source, [...operation.leftRunIds, ...operation.rightRunIds]);
      return comparisonDocument(source, loadReferencedOrigins(source, selected), operation);
    }
  }
}

function runsListExplanation(
  source: InspectionFactSource,
  operation: Extract<InspectionOperation, { readonly kind: "runs.list" }>,
): InspectionDocument {
  const page = runSummaryPage(source, operation.continuation);
  return Object.freeze({
    ...runsListBase(page.cutoff, page.items, page.truncated),
    factKinds: factKinds(operation.kind),
    ...(page.continuation === undefined ? {} : { continuation: page.continuation }),
  });
}

function runsListDocument(
  source: InspectionFactSource,
  operation: Extract<InspectionOperation, { readonly kind: "runs.list" }>,
): InspectionDocument {
  const page = runSummaryPage(source, operation.continuation);
  return Object.freeze({
    ...runsListBase(page.cutoff, page.items, page.truncated),
    runs: closeJson(page.items),
    ...(page.continuation === undefined ? {} : { continuation: page.continuation }),
  });
}

function runSummaryPage(source: InspectionFactSource, continuation: string | undefined) {
  const binding = continuation === undefined ? undefined : decodeContinuation(continuation);
  let page: SealedRunSummaryPage;
  try {
    page = source.readSealedRunSummaryPage(
      binding?.afterRunId ?? "",
      RUN_LIST_PAGE_SIZE,
      binding?.cutoffIdentity,
    );
  } catch (cause) {
    throw hostFailure(
      "runs.list",
      "Continuation is invalid or its sealed cutoff changed; restart runs.list",
      cause,
    );
  }
  return Object.freeze({
    cutoff: page.cutoff,
    items: page.summaries,
    truncated: page.nextAfterRunId !== null,
    continuation: page.nextAfterRunId === null
      ? undefined
      : encodeContinuation(page.nextAfterRunId, page.cutoff.identity),
  });
}

function runsListBase(
  cutoff: SealedRunCutoff,
  selected: readonly SealedRunSummary[],
  truncated: boolean,
): InspectionDocument {
  return Object.freeze({
    protocol: QUERY_PROTOCOL,
    operation: "runs.list" as const,
    behaviorVersion: inspectionBehaviorVersion("runs.list"),
    sealedCutoff: closeJson(Object.freeze({
      kind: "inspection-sealed-cutoff",
      identity: cutoff.identity,
      runCount: cutoff.runCount,
    })),
    selection: closeJson(Object.freeze({
      requestedRunIds: Object.freeze([]),
      selectedRunIds: Object.freeze(selected.map(({ runId }) => runId)),
      missingRunIds: Object.freeze([]),
      returnedRunCount: selected.length,
      totalRunCount: cutoff.runCount,
      truncated,
    })),
    issues: Object.freeze([]),
    evidence: closeJson(Object.freeze({ refs: Object.freeze([]) })),
  });
}

function encodeContinuation(afterRunId: string, cutoffIdentity: string): string {
  return Buffer.from(JSON.stringify([
    CONTINUATION_PROTOCOL,
    "runs.list",
    inspectionBehaviorVersion("runs.list"),
    cutoffIdentity,
    afterRunId,
  ]), "utf8")
    .toString("base64url");
}

function decodeContinuation(token: string): {
  readonly cutoffIdentity: string;
  readonly afterRunId: string;
} {
  try {
    const decoded = JSON.parse(Buffer.from(token, "base64url").toString("utf8")) as unknown;
    if (!Array.isArray(decoded) || decoded.length !== 5 || decoded[0] !== CONTINUATION_PROTOCOL ||
      decoded[1] !== "runs.list" || decoded[2] !== inspectionBehaviorVersion("runs.list") ||
      typeof decoded[3] !== "string" || typeof decoded[4] !== "string") {
      throw new Error("continuation binding changed");
    }
    return Object.freeze({ cutoffIdentity: decoded[3], afterRunId: decoded[4] });
  } catch (cause) {
    throw hostFailure("runs.list", "Continuation is invalid or its sealed cutoff changed; restart runs.list", cause);
  }
}

function loadForOperation(source: InspectionFactSource, operation: InspectionOperation): {
  readonly selected: readonly LoadedRun[];
  readonly requestedRunIds: readonly string[];
  readonly missingRunIds: readonly string[];
} {
  if (operation.kind === "runs.list") return { selected: [], requestedRunIds: [], missingRunIds: [] };
  if (operation.kind === "runs.compare") {
    const requested = Object.freeze([...operation.leftRunIds, ...operation.rightRunIds]);
    const selected = selectRuns(loadRuns(source, requested), requested);
    return {
      selected: loadReferencedOrigins(source, selected.selected),
      requestedRunIds: requested,
      missingRunIds: selected.missing,
    };
  }
  if ("runId" in operation) {
    const selected = selectRuns(loadRuns(source, [operation.runId]), [operation.runId]);
    requireOne(operation.kind, selected.selected, operation.runId);
    return {
      selected: operation.kind === "run.summary"
        ? loadSummaryFacts(source, selected.selected[0]!)
        : selected.selected,
      requestedRunIds: [operation.runId],
      missingRunIds: selected.missing,
    };
  }
  const resolved = requireAttemptFromSource(source, operation.kind, operation.locator);
  return {
    selected: attemptRuns(resolved),
    requestedRunIds: Object.freeze([]),
    missingRunIds: Object.freeze([]),
  };
}

function loadRuns(source: InspectionFactSource, runIds: readonly string[]): readonly LoadedRun[] {
  const uniqueRunIds = [...new Set(runIds)];
  if (uniqueRunIds.length > RUN_SELECTION_LIMIT) {
    throw new Error(`Inspection selection exceeds the fixed ${RUN_SELECTION_LIMIT}-Run limit`);
  }
  const output: LoadedRun[] = [];
  for (const runId of uniqueRunIds) {
    const physical = source.readSealedRunCore(runId);
    if (physical !== undefined) output.push(decodeRun(source, physical));
  }
  return Object.freeze(output);
}

function loadReferencedOrigins(
  source: InspectionFactSource,
  targets: readonly LoadedRun[],
): readonly LoadedRun[] {
  const targetIds = new Set(targets.map(({ run }) => run.runId));
  const originIds = [...new Set(targets.flatMap(({ members }) => members.flatMap(({ attempt }) =>
    attempt === null || targetIds.has(attempt.originRunId) ? [] : [attempt.originRunId])))];
  return uniqueRuns([...targets, ...loadRuns(source, originIds)]);
}

function loadSummaryFacts(source: InspectionFactSource, target: LoadedRun): readonly LoadedRun[] {
  return loadReferencedOrigins(source, [target]);
}

function decodeRun(source: InspectionFactSource, physical: SealedRunCore): LoadedRun {
  const run = rightOrThrow(decodeRunDocument(parseJson(physical.runCoreBytes)), "Run Core is invalid");
  const members = physical.members.map((member) =>
    rightOrThrow(decodeMemberDocument(parseJson(member.coreBytes)), "Member Core is invalid"));
  const attempts = physical.attempts.map((attempt) =>
    rightOrThrow(decodeAttemptDocument(parseJson(attempt.coreBytes)), "Attempt Core is invalid"));
  const attachments = physical.attachments.map((attachment): DecodedAttachment => Object.freeze({
    physical: attachment,
    value: closeJson(parseJson(attachment.canonicalBytes)),
  }));
  return Object.freeze({ source, physical, run, members: Object.freeze(members), attempts: Object.freeze(attempts), attachments: Object.freeze(attachments) });
}

function parseJson(bytes: Uint8Array): unknown {
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
}

function rightOrThrow<A>(decoded: Result.Result<A, unknown>, reason: string): A {
  if (Result.isFailure(decoded)) throw new Error(reason);
  return decoded.success;
}

function selectRuns(all: readonly LoadedRun[], runIds: readonly string[]) {
  const byId = new Map<string, LoadedRun>(all.map((run) => [run.run.runId, run]));
  const requested = [...new Set(runIds)];
  return Object.freeze({
    selected: Object.freeze(requested.flatMap((runId) => {
      const run = byId.get(runId);
      return run === undefined ? [] : [run];
    })),
    missing: Object.freeze(requested.filter((runId) => !byId.has(runId))),
  });
}

function requireOne(operation: InspectionOperationId, selected: readonly LoadedRun[], runId: string): LoadedRun {
  const run = selected[0];
  if (run === undefined) throw hostFailure(operation, `Run ${runId} was not found`);
  return run;
}

function resolveAttemptFromSource(
  source: InspectionFactSource,
  operation: InspectionOperationId,
  locator: string,
): ResolvedAttempt | undefined {
  const projection = source.findAttemptLocatorCandidates(locator, ATTEMPT_CANDIDATE_RUN_LIMIT);
  if (projection.candidates.length === 0) return undefined;
  if (projection.ambiguous) {
    throw hostFailure(operation, `Attempt ${locator} is ambiguous because its 60-bit locator collides`);
  }
  const origins = projection.candidates.filter(({ relation }) => relation === "origin");
  if (origins.length !== 1) {
    throw hostFailure(operation, `Attempt ${locator} indexed projection is invalid`);
  }
  const identity = origins[0]!;
  const loaded = loadRuns(source, projection.candidates.map(({ runId }) => runId));
  const byRunId = new Map<string, LoadedRun>(loaded.map((run) => [run.run.runId, run] as const));
  const origin = byRunId.get(identity.originRunId);
  if (origin === undefined) {
    throw hostFailure(operation, `Attempt ${locator} indexed origin is not a sealed Run`);
  }
  const attempt = origin.attempts.find((candidate) =>
    candidate.attemptId === identity.attemptId &&
    candidate.originRunId === identity.originRunId &&
    encodeAttemptLocator(candidate.attemptId) === locator);
  if (attempt === undefined) {
    throw hostFailure(operation, `Attempt ${locator} indexed origin Core is invalid`);
  }
  const targets: { readonly run: LoadedRun; readonly member: MemberDocument }[] = [];
  const targetRunIds = new Set<string>(projection.candidates.flatMap((candidate) =>
    candidate.relation === "target" && candidate.originRunId === identity.originRunId &&
      candidate.attemptId === identity.attemptId
      ? [candidate.runId]
      : []));
  for (const runId of targetRunIds) {
    const run = byRunId.get(runId);
    if (run === undefined) {
      throw hostFailure(operation, `Attempt ${locator} indexed target is not a sealed Run`);
    }
    const members = run.members.filter((member) => member.attempt !== null &&
      member.attempt.originRunId === identity.originRunId &&
      member.attempt.attemptId === identity.attemptId);
    if (members.length === 0) {
      throw hostFailure(operation, `Attempt ${locator} indexed target Core is invalid`);
    }
    if (targets.length + members.length > ATTEMPT_TARGET_MEMBER_LIMIT) {
      throw hostFailure(operation, `Attempt ${locator} exceeds the fixed target member limit`);
    }
    targets.push(...members.map((member) => Object.freeze({ run, member })));
  }
  return Object.freeze({ attempt, origin, locator, targets: Object.freeze(targets) });
}

function requireAttemptFromSource(
  source: InspectionFactSource,
  operation: InspectionOperationId,
  locator: string,
): ResolvedAttempt {
  const resolved = resolveAttemptFromSource(source, operation, locator);
  if (resolved === undefined) throw hostFailure(operation, `Attempt ${locator} was not found or is ambiguous`);
  return resolved;
}

function attemptRuns(resolved: ResolvedAttempt): readonly LoadedRun[] {
  return uniqueRuns([resolved.origin, ...resolved.targets.map(({ run }) => run)]);
}

function attemptAttachment(resolved: ResolvedAttempt, family: string): DecodedAttachment | undefined {
  return resolved.origin.attachments.find(({ physical }) =>
    physical.ownerKind === "attempt" && physical.ownerAttemptId === resolved.attempt.attemptId && physical.family === family);
}

function runAttachment(run: LoadedRun, family: string): DecodedAttachment | undefined {
  return run.attachments.find(({ physical }) =>
    physical.ownerKind === "run" && physical.family === family);
}

function attachmentValue(resolved: ResolvedAttempt, family: string): InspectionJson {
  const attachment = attemptAttachment(resolved, family);
  return attachment === undefined
    ? Object.freeze({ state: "not-recorded" })
    : Object.freeze({
        state: "available",
        value: attachment.value,
        collection: attachmentCollectionPage(resolved.origin.source, attachment),
      });
}

function runAttachmentValue(run: LoadedRun, family: string): InspectionJson {
  const attachment = runAttachment(run, family);
  return attachment === undefined
    ? Object.freeze({ state: "not-recorded" })
    : Object.freeze({
        state: "available",
        value: attachment.value,
        collection: attachmentCollectionPage(run.source, attachment),
      });
}

function attachmentCollectionPage(
  source: InspectionFactSource,
  attachment: DecodedAttachment,
): InspectionJson {
  const page = source.readCollectionPage(
    attachment.physical.attachmentId,
    -1,
    ATTACHMENT_COLLECTION_PAGE_SIZE,
  );
  return closeJson(Object.freeze({
    state: page.nextOrdinal === null ? "complete-page" : "bounded-page",
    items: Object.freeze(page.items.map((item) => closeJson(parseJson(item.canonicalBytes)))),
    hasMore: page.nextOrdinal !== null,
  }));
}

/**
 * Query keeps one leading and one decisive matcher representative. The full
 * durable artifact remains available in the Record, while attempt.get stays a
 * bounded AI-facing overview instead of duplicating attempt.trace-sized data.
 */
function compactAssertionInspection(value: InspectionJson): InspectionJson {
  if (Array.isArray(value)) return Object.freeze(value.map(compactAssertionInspection));
  if (typeof value !== "object" || value === null) return value;
  const output: Record<string, InspectionJson> = {};
  for (const [key, entry] of Object.entries(value)) {
    if ((key === "retainedRows" || key === "representatives") && Array.isArray(entry) && entry.length > 2) {
      output[key] = Object.freeze([
        compactAssertionInspection(entry[0]!),
        compactAssertionInspection(entry[entry.length - 1]!),
      ]);
    } else {
      output[key] = compactAssertionInspection(entry);
    }
  }
  return Object.freeze(output);
}

function assertionEvidence(resolved: ResolvedAttempt): InspectionJson {
  const attachment = attemptAttachment(resolved, NiceEvalRecordAttachments.assertions.family);
  return attachment === undefined
    ? Object.freeze({ state: "not-recorded" })
    : Object.freeze({
        state: "available",
        value: compactAssertionInspection(attachment.value),
        collection: attachmentCollectionPage(resolved.origin.source, attachment),
      });
}

function attemptDetail(resolved: ResolvedAttempt): InspectionJson {
  const assertions = decodedAssertions(resolved);
  return closeJson(Object.freeze({
    core: resolved.attempt,
    locator: resolved.locator,
    originRun: resolved.origin.run,
    targets: resolved.targets.map(({ run, member }) => Object.freeze({ runId: run.run.runId, member })),
    evidence: assertionEvidence(resolved),
    verdict: attemptVerdict(resolved),
    score: assertionScore(assertions?.entries ?? []),
    evidenceCoverage: attemptEvidenceCoverage(resolved),
    limitations: attemptLimitations(resolved, assertions?.entries ?? []),
  }));
}

function runSummary(all: readonly LoadedRun[], selected: LoadedRun): InspectionJson {
  const slots = selected.run.expectedSlots.map((slot) => {
    const member = selected.members.find((candidate) => candidate.slotId === slot.slotId);
    if (member === undefined || member.attempt === null) {
      return Object.freeze({
        runId: selected.run.runId, ...slot, state: member?.action ?? "missing", locator: null,
        outcome: null, verdict: null, usage: Object.freeze({ inputTokens: 0, outputTokens: 0 }),
      });
    }
    const origin = all.find(({ run }) => run.runId === member.attempt!.originRunId);
    const attempt = origin?.attempts.find(({ attemptId }) => attemptId === member.attempt!.attemptId);
    if (origin === undefined || attempt === undefined) {
      return Object.freeze({
        runId: selected.run.runId, ...slot, state: "missing", locator: null,
        outcome: null, verdict: null, usage: Object.freeze({ inputTokens: 0, outputTokens: 0 }),
      });
    }
    const resolved: ResolvedAttempt = Object.freeze({
      attempt,
      origin,
      locator: encodeAttemptLocator(attempt.attemptId),
      targets: Object.freeze([{ run: selected, member }]),
    });
    return Object.freeze({
      runId: selected.run.runId, ...slot, state: member.action, locator: resolved.locator,
      outcome: attempt.outcome,
      verdict: attemptVerdict(resolved),
      score: assertionScore(decodedAssertions(resolved)?.entries ?? []),
      evidenceCoverage: attemptEvidenceCoverage(resolved),
      limitations: attemptLimitations(resolved, decodedAssertions(resolved)?.entries ?? []),
      usage: attemptUsage(resolved),
    });
  });
  return closeJson(Object.freeze({
    runs: Object.freeze([selected.run]),
    denominator: Object.freeze({ expected: slots.length, observed: slots.filter(({ locator }) => locator !== null).length }),
    members: Object.freeze(slots),
  }));
}

function attemptVerdict(resolved: ResolvedAttempt): string | null {
  const attachment = attemptAttachment(resolved, NiceEvalRecordAttachments.assertions.family);
  if (attachment === undefined) return null;
  const decoded = decodeAssertionsAttachment(attachment);
  if (decoded !== undefined) return foldRecordedAttemptVerdict({ outcome: resolved.attempt.outcome, assertions: decoded });
  if (!isCurrentAssertionsAttachment(attachment)) return null;
  if (resolved.attempt.outcome === "errored" || resolved.attempt.outcome === "interrupted") return "errored";
  if (containsRequiredAssertionError(attachment.value)) return "errored";
  return containsFailedDecision(attachment.value) ? "failed" : null;
}

function decodedAssertions(resolved: ResolvedAttempt) {
  const attachment = attemptAttachment(resolved, NiceEvalRecordAttachments.assertions.family);
  if (attachment === undefined) return undefined;
  return decodeAssertionsAttachment(attachment);
}

function exactMarker(value: unknown, key: string): unknown | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== 1 || keys[0] !== key) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor?.enumerable === true && "value" in descriptor ? descriptor.value : undefined;
}

function hasOwnMarker(value: unknown, key: string): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value) &&
    Object.prototype.hasOwnProperty.call(value, key);
}

/** Hydrates the sealed current wire value before applying the logical Assertions schema. */
function decodeAssertionsAttachment(attachment: DecodedAttachment) {
  const definition = NiceEvalRecordAttachments.assertions;
  if (!isCurrentAssertionsAttachment(attachment)) return undefined;

  const byHandle = new Map(attachment.physical.contents.map((content) => [content.logicalHandle, content]));
  const handles = new Map<string, RecordContentHandle>();
  const usedContent = new Set<string>();
  const hydrated = hydrateRecordAttachmentCurrent(definition, attachment.value, {
    content: (token, declaration) => {
      const logicalHandle = exactMarker(token, "$niceeval.record.content");
      if (logicalHandle === undefined && !hasOwnMarker(token, "$niceeval.record.content")) {
        return Result.succeed(undefined);
      }
      const metadata = typeof logicalHandle === "string" ? byHandle.get(logicalHandle) : undefined;
      if (
        metadata === undefined ||
        declaration.maximumBytes !== undefined && metadata.byteLength > declaration.maximumBytes
      ) return Result.fail({ code: "current-content-bind-failed" as const });
      let handle = handles.get(logicalHandle as string);
      if (handle === undefined) {
        handle = mintRecordContentHandle(declaration.kind);
        handles.set(logicalHandle as string, handle);
      }
      usedContent.add(logicalHandle as string);
      return Result.succeed(handle);
    },
    reference: (token, declaration) => {
      const marker = exactMarker(token, "$niceeval.record.reference");
      if (marker === undefined && !hasOwnMarker(token, "$niceeval.record.reference")) {
        return Result.succeed(undefined);
      }
      if (typeof marker !== "object" || marker === null || Array.isArray(marker)) {
        return Result.fail({ code: "current-reference-bind-failed" as const });
      }
      const value = marker as Record<string, unknown>;
      if (
        Reflect.ownKeys(value).length !== 3 ||
        value.owner !== declaration.definition.owner ||
        value.family !== declaration.definition.family ||
        !("value" in value)
      ) return Result.fail({ code: "current-reference-bind-failed" as const });
      return Result.succeed(mintRecordAttachmentReference(
        RecordAttachmentReference.to(declaration.definition, declaration.valueSchema),
        value.value,
      ));
    },
  });
  if (Result.isFailure(hydrated) || usedContent.size !== attachment.physical.contents.length) return undefined;

  const closure = enumerateRecordAttachmentClosure(definition, hydrated.success);
  if (Result.isFailure(closure)) return undefined;
  const logicalReferences = new Map<string, { readonly owner: string; readonly family: string }>();
  for (const reference of closure.success.references) {
    const wire = recordAttachmentReferenceWire(reference);
    if (wire === undefined) return undefined;
    logicalReferences.set(`${wire.owner}\u0000${wire.family}`, Object.freeze({ owner: wire.owner, family: wire.family }));
  }
  const ordered = [...logicalReferences.values()].sort((left, right) =>
    left.owner === right.owner
      ? left.family === right.family ? 0 : left.family < right.family ? -1 : 1
      : left.owner < right.owner ? -1 : 1);
  if (ordered.length !== attachment.physical.references.length) return undefined;
  for (let ordinal = 0; ordinal < ordered.length; ordinal += 1) {
    const logical = ordered[ordinal]!;
    const physical = attachment.physical.references[ordinal]!;
    if (physical.ordinal !== ordinal || physical.owner !== logical.owner || physical.family !== logical.family) return undefined;
  }
  return hydrated.success;
}

function isCurrentAssertionsAttachment(attachment: DecodedAttachment): boolean {
  const persistence = NiceEvalRecordAttachmentCatalog.persistence(NiceEvalRecordAttachments.assertions);
  return persistence !== undefined && attachment.physical.familyRevision === persistence.revision;
}

function assertionScore(entries: readonly {
  readonly contribution: { readonly state: string; readonly points?: number; readonly earned?: number };
}[]): InspectionJson {
  let possible = 0;
  let earned = 0;
  let scored = 0;
  let unavailable = 0;
  for (const { contribution } of entries) {
    if (contribution.state === "earned" && typeof contribution.points === "number" && typeof contribution.earned === "number") {
      possible += contribution.points;
      earned += contribution.earned;
      scored += 1;
    } else if (contribution.state === "unavailable" && typeof contribution.points === "number") {
      possible += contribution.points;
      unavailable += 1;
    }
  }
  return closeJson(scored === 0 && unavailable === 0
    ? Object.freeze({ state: "not-scored" as const })
    : unavailable > 0
      ? Object.freeze({ state: "unavailable" as const, earned, possible, unavailable })
      : Object.freeze({ state: "complete" as const, earned, possible }));
}

function attemptEvidenceCoverage(resolved: ResolvedAttempt): InspectionJson {
  const entries = new Map<string, InspectionJson>();
  const visit = (value: InspectionJson): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (typeof value !== "object" || value === null) return;
    const record = value as Readonly<Record<string, InspectionJson>>;
    const coverage = record.evidenceCoverage;
    if (typeof coverage === "object" && coverage !== null && !Array.isArray(coverage)) {
      for (const [channel, raw] of Object.entries(coverage)) {
        const detail = typeof raw === "object" && raw !== null && !Array.isArray(raw)
          ? raw as Readonly<Record<string, InspectionJson>>
          : undefined;
        const status = typeof raw === "string"
          ? raw
          : typeof detail?.status === "string"
            ? detail.status
            : typeof detail?.state === "string"
              ? detail.state
              : undefined;
        if (status === undefined) continue;
        const reason = typeof detail?.reason === "string" ? detail.reason : undefined;
        const item = closeJson(Object.freeze({ channel, status, ...(reason === undefined ? {} : { reason }) }));
        entries.set(`${channel}\u0000${status}\u0000${reason ?? ""}`, item);
      }
    }
    Object.values(record).forEach(visit);
  };
  for (const attachment of resolved.origin.attachments) {
    if (attachment.physical.ownerKind !== "attempt" || attachment.physical.ownerAttemptId !== resolved.attempt.attemptId) continue;
    visit(attachment.value);
  }
  return Object.freeze([...entries.values()]);
}

function attemptLimitations(
  resolved: ResolvedAttempt,
  entries: readonly {
    readonly materials: {
      readonly coverage: { readonly state: string; readonly reason?: string };
      readonly limitations: readonly object[];
    };
  }[],
): InspectionJson {
  const limitations: InspectionJson[] = [];
  for (const entry of entries) {
    if (entry.materials.coverage.state !== "complete") {
      limitations.push(closeJson(Object.freeze({
        owner: "assertion-material",
        state: entry.materials.coverage.state,
        ...(entry.materials.coverage.reason === undefined ? {} : { reason: entry.materials.coverage.reason }),
        limitations: entry.materials.limitations,
      })));
    }
  }
  const coverage = attemptEvidenceCoverage(resolved);
  if (Array.isArray(coverage)) {
    for (const entry of coverage) {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry) || entry.status === "complete") continue;
      limitations.push(closeJson(entry));
    }
  }
  return Object.freeze(limitations);
}

function containsFailedDecision(value: InspectionJson): boolean {
  const entries = assertionWireEntries(value);
  return entries?.some((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return false;
    const decision = (entry as Readonly<Record<string, InspectionJson>>).decision;
    if (typeof decision !== "object" || decision === null || Array.isArray(decision)) return false;
    const record = decision as Readonly<Record<string, InspectionJson>>;
    return record.result === "mismatched" && record.gate === "failed";
  }) ?? false;
}

function containsRequiredAssertionError(value: InspectionJson): boolean {
  const entries = assertionWireEntries(value);
  return entries?.some((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return false;
    const record = entry as Readonly<Record<string, InspectionJson>>;
    const decision = record.decision;
    const policy = record.policy;
    const requirement = typeof policy === "object" && policy !== null && !Array.isArray(policy)
      ? (policy as Readonly<Record<string, InspectionJson>>).requirement
      : undefined;
    if (
      typeof decision !== "object" || decision === null || Array.isArray(decision) ||
      typeof requirement !== "object" || requirement === null || Array.isArray(requirement)
    ) return false;
    const decisionRecord = decision as Readonly<Record<string, InspectionJson>>;
    const requirementRecord = requirement as Readonly<Record<string, InspectionJson>>;
    return (decisionRecord.result === "unavailable" || decisionRecord.result === "errored") &&
      decisionRecord.gate === "unavailable" &&
      requirementRecord.state === "available" && requirementRecord.value === "required";
  }) ?? false;
}

function assertionWireEntries(value: InspectionJson): readonly InspectionJson[] | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const entries = (value as Readonly<Record<string, InspectionJson>>)["entries-data"];
  return Array.isArray(entries) ? entries : undefined;
}

function attemptUsage(resolved: ResolvedAttempt) {
  let inputTokens = 0;
  let outputTokens = 0;
  const visit = (value: InspectionJson): void => {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (typeof value !== "object" || value === null) return;
    const record = value as Readonly<Record<string, InspectionJson>>;
    if (record.kind === "token-bucket" && typeof record.tokens === "number") {
      if (record.bucket === "input") inputTokens += record.tokens;
      if (record.bucket === "output") outputTokens += record.tokens;
    }
    Object.values(record).forEach(visit);
  };
  for (const attachment of resolved.origin.attachments) {
    if (attachment.physical.ownerKind === "attempt" && attachment.physical.ownerAttemptId === resolved.attempt.attemptId) visit(attachment.value);
  }
  return Object.freeze({ inputTokens, outputTokens });
}

function comparisonDocument(
  source: InspectionFactSource,
  all: readonly LoadedRun[],
  operation: Extract<InspectionOperation, { readonly kind: "runs.compare" }>,
): InspectionDocument {
  const left = selectRuns(all, operation.leftRunIds);
  const right = selectRuns(all, operation.rightRunIds);
  const leftMembers = comparisonMembers(all, left.selected);
  const rightMembers = comparisonMembers(all, right.selected);
  const leftKeys = leftMembers.map(({ key }) => key).sort();
  const rightKeys = rightMembers.map(({ key }) => key).sort();
  const exact = arraysEqual(leftKeys, rightKeys);
  const rightByKey = new Map(rightMembers.map((member) => [member.key, member] as const));
  const pairs = leftMembers.flatMap((member) => {
    const paired = rightByKey.get(member.key);
    return paired === undefined ? [] : [Object.freeze({ key: member.key, left: member, right: paired })];
  });
  const issues: InspectionJson[] = [
    ...left.missing.map((runId) => closeJson({ code: "selection-run-missing", side: "left", runId })),
    ...right.missing.map((runId) => closeJson({ code: "selection-run-missing", side: "right", runId })),
    ...(operation.mode === "exact" && !exact ? [closeJson({ code: "comparison-member-set-mismatch" })] : []),
  ];
  return Object.freeze({
    ...baseDocument(source, operation.kind, [...left.selected, ...right.selected], [...operation.leftRunIds, ...operation.rightRunIds], [...left.missing, ...right.missing], [
      ...leftMembers.map(({ locator }) => locator), ...rightMembers.map(({ locator }) => locator),
    ], issues),
    comparison: boundedJson(Object.freeze({
      mode: operation.mode,
      left: Object.freeze({ runs: left.selected.map(({ run }) => run), members: leftMembers }),
      right: Object.freeze({ runs: right.selected.map(({ run }) => run), members: rightMembers }),
      exactMemberSet: exact,
      pairs: operation.mode === "side-by-side" ? Object.freeze([]) : Object.freeze(pairs),
    })),
  });
}

function comparisonMembers(all: readonly LoadedRun[], runs: readonly LoadedRun[]) {
  return runs.flatMap((run) => run.members.flatMap((member) => {
    if (member.attempt === null) return [];
    const slot = run.run.expectedSlots.find(({ slotId }) => slotId === member.slotId);
    const origin = all.find(({ run: candidate }) => candidate.runId === member.attempt!.originRunId);
    const attempt = origin?.attempts.find(({ attemptId }) => attemptId === member.attempt!.attemptId);
    if (slot === undefined || attempt === undefined) return [];
    return [Object.freeze({
      key: `${run.run.experimentId}\u0000${slot.evalId}\u0000${slot.attemptOrdinal}`,
      runId: run.run.runId, slotId: slot.slotId, evalId: slot.evalId, attemptOrdinal: slot.attemptOrdinal,
      locator: encodeAttemptLocator(attempt.attemptId),
    })];
  }));
}

function baseDocument(
  source: InspectionFactSource,
  operation: InspectionOperationId,
  selectedInput: readonly LoadedRun[],
  requestedRunIds: readonly string[],
  missingRunIds: readonly string[],
  evidence: readonly string[],
  issues: readonly InspectionJson[] = [],
): InspectionDocument {
  const selected = uniqueRuns(selectedInput);
  const seals = selected.map(({ run, physical }) => Object.freeze({ runId: run.runId, logicalSealIdentity: physical.logicalSealIdentity }));
  const cutoff = source.cutoff();
  return Object.freeze({
    protocol: QUERY_PROTOCOL,
    operation,
    behaviorVersion: inspectionBehaviorVersion(operation),
    sealedCutoff: closeJson(Object.freeze({
      kind: "inspection-sealed-cutoff",
      identity: cutoff.identity,
      runCount: cutoff.runCount,
      runs: Object.freeze(seals),
    })),
    selection: closeJson(Object.freeze({
      requestedRunIds: Object.freeze([...requestedRunIds]),
      selectedRunIds: Object.freeze(selected.map(({ run }) => run.runId)),
      missingRunIds: Object.freeze([...missingRunIds]),
    })),
    issues: Object.freeze(issues),
    evidence: closeJson(Object.freeze({ refs: Object.freeze([...new Set(evidence)].sort()) })),
  });
}

function locators(runs: readonly LoadedRun[]): readonly string[] {
  return Object.freeze(runs.flatMap(({ attempts }) => attempts.map(({ attemptId }) => encodeAttemptLocator(attemptId))));
}

function uniqueRuns(runs: readonly LoadedRun[]): readonly LoadedRun[] {
  return Object.freeze([...new Map(runs.map((run) => [run.run.runId, run] as const)).values()]);
}

function factKinds(operation: InspectionOperationId): readonly string[] {
  switch (operation) {
    case "runs.list":
    case "run.get": return Object.freeze(["core"]);
    case "run.summary": return Object.freeze(["core", "assertions", "agent-turns"]);
    case "attempt.get": return Object.freeze(["core", "assertions"]);
    case "attempt.trace": return Object.freeze(["agent-turns", "turn-contexts", "sandbox-commands", "runner-activities", "runner-diagnostics"]);
    case "attempt.diff": return Object.freeze(["file-changes"]);
    case "attempt.sources": return Object.freeze(["assertions", "sources"]);
    case "attempt.artifacts": return Object.freeze(["artifacts"]);
    case "runs.compare": return Object.freeze(["core", "assertions", "agent-turns"]);
  }
}

function closeJson(value: unknown): InspectionJson {
  const closed = closeInspectionJson(value);
  if (typeof closed === "object" && closed !== null && !Array.isArray(closed) && Reflect.get(closed, "code") === "inspection-result-invalid") {
    throw new Error(String(Reflect.get(closed, "reason")));
  }
  return closed as InspectionJson;
}

function boundedJson(value: unknown): InspectionJson {
  const closed = closeJson(value);
  const byteLength = Buffer.byteLength(JSON.stringify(closed), "utf8");
  if (byteLength <= INSPECTION_RESULT_BYTE_LIMIT) return closed;
  return closeJson(Object.freeze({
    state: "omitted",
    reason: "inspection-result-byte-limit",
    byteLimit: INSPECTION_RESULT_BYTE_LIMIT,
  }));
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

function hostFailure(
  operation: InspectionOperationId | "discover",
  reason: string,
  cause?: unknown,
): InspectionHostError {
  return new InspectionHostError({
    code: reason.includes("not found") || reason.includes("ambiguous") ? "inspection-selection-missing" : "inspection-operation-failed",
    operation,
    reason,
    ...(cause === undefined ? {} : { cause }),
  });
}
