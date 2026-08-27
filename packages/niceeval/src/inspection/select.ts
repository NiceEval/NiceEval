import { Data } from "effect";

import { encodeAttemptLocator } from "../attempt-locator.ts";
import { foldRecordedAttemptVerdict } from "../eval/record/verdict.ts";
import {
  NiceEvalCurrentRecordAttachments,
  NiceEvalRecordAttachments,
} from "../record/family/current.ts";
import type {
  SealedRunCutoff,
  SealedRunSummary,
  SealedRunSummaryPage,
} from "../record/sqlite/index.ts";
import { inspectionBehaviorVersion } from "./catalog.ts";
import { decodeBase64UrlUtf8, encodeBase64UrlUtf8, utf8ByteLength } from "./bytes.ts";
import {
  QUERY_PROTOCOL,
  closeInspectionJson,
  type InspectionDocument,
  type InspectionJson,
  type InspectionOperation,
  type InspectionOperationId,
  type InspectionSourceProvenance,
} from "./codec.ts";
import { INSPECTION_RESULT_BYTE_LIMIT } from "./limits.ts";
import { projectAttemptAssertionDetail, projectAttemptAssertionIndex } from "./assertions.ts";
import {
  attemptAttachment,
  loadInspectionRuns,
  loadSelectedInspectionRuns,
  readInspectionAssertions,
  resolveInspectionAttempt,
  resolveInspectionMemberAttempt,
  runAttachment,
  type DecodedInspectionAttachment,
  type LoadedInspectionRun,
  type ResolvedInspectionAttempt,
} from "./facts.ts";
import { selectInspectionOverview } from "./overview.ts";
import type { InspectionFactSource } from "./source.ts";
import { projectAttemptSources } from "./sources.ts";
import {
  readInspectionAgentTurns,
  projectAttemptTrace,
  projectAttemptTraceDetail,
  type AttemptTraceAttachments,
} from "./trace.ts";

/** Typed browser-neutral failure from one fixed Inspection operation. */
export class InspectionOperationError extends Data.TaggedError("InspectionOperationError")<{
  readonly code:
    | "inspection-selection-missing"
    | "inspection-operation-failed";
  readonly operation: InspectionOperationId;
  readonly reason: string;
  readonly cause?: unknown;
}> {}

const RUN_LIST_PAGE_SIZE = 100;
const ATTACHMENT_COLLECTION_PAGE_SIZE = 64;
const ATTACHMENT_CONTENT_METADATA_LIMIT = 64;
const RUN_SELECTION_LIMIT = 64;
const CONTINUATION_PROTOCOL = "niceeval.query-continuation/v1";

/** Pure fixed-operation selector shared by Node CLI and browser View adapters. */
export function selectInspectionOperation(
  facts: InspectionFactSource,
  operation: InspectionOperation,
): InspectionDocument {
  return evaluateInspectionOperation(
    operation.kind,
    () => selectOperation(facts, operation),
  );
}

/** Internal CLI explanation over the same selected facts and cutoff. */
export function explainInspectionOperation(
  facts: InspectionFactSource,
  operation: InspectionOperation,
): InspectionDocument {
  return evaluateInspectionOperation(operation.kind, () => {
    if (operation.kind === "runs.list") {
      return runsListExplanation(facts, operation);
    }
    const loaded = loadForOperation(facts, operation);
    return Object.freeze({
      ...baseDocument(
        facts,
        operation.kind,
        loaded.selected,
        loaded.requestedRunIds,
        loaded.missingRunIds,
        [],
      ),
      factKinds: factKinds(operation.kind),
    });
  });
}

function selectOperation(
  source: InspectionFactSource,
  operation: InspectionOperation,
): InspectionDocument {
  switch (operation.kind) {
    case "overview.get": {
      const selected = loadInspectionRuns(source);
      return Object.freeze({
        ...baseDocument(source, operation.kind, selected, [], [], locators(selected)),
        overview: boundedJson(selectInspectionOverview(selected)),
      });
    }
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
    case "attempt.assertion.detail": {
      const resolved = requireAttemptFromSource(source, operation.kind, operation.locator);
      const assertions = readInspectionAssertions(resolved);
      const assertion = projectAttemptAssertionDetail(
        source,
        assertions,
        readInspectionAgentTurns(traceAttachments(resolved).agentTurns),
        operation.entryId,
      );
      if (assertion === undefined) {
        throw selectionMissing(
          operation.kind,
          `Assertion ${operation.entryId} was not found`,
        );
      }
      return Object.freeze({
        ...baseDocument(source, operation.kind, attemptRuns(resolved), [], [], [operation.locator]),
        assertion: boundedJson(assertion),
      });
    }
    case "attempt.trace": {
      const resolved = requireAttemptFromSource(source, operation.kind, operation.locator);
      return Object.freeze({
        ...baseDocument(source, operation.kind, attemptRuns(resolved), [], [], [operation.locator]),
        trace: boundedJson(projectAttemptTrace(resolved.origin.source, traceAttachments(resolved))),
      });
    }
    case "attempt.trace.detail": {
      const resolved = requireAttemptFromSource(source, operation.kind, operation.locator);
      const detail = projectAttemptTraceDetail(
        resolved.origin.source,
        traceAttachments(resolved),
        operation.selector,
      );
      if (detail === undefined) {
        throw selectionMissing(
          operation.kind,
          "Trace detail identity was not found",
        );
      }
      return Object.freeze({
        ...baseDocument(source, operation.kind, attemptRuns(resolved), [], [], [operation.locator]),
        detail: boundedJson(detail),
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
          readInspectionAssertions(resolved),
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
    ...runsListBase(source, page.cutoff, page.items, page.truncated),
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
    ...runsListBase(source, page.cutoff, page.items, page.truncated),
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
    throw operationFailure(
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
  source: InspectionFactSource,
  cutoff: SealedRunCutoff,
  selected: readonly SealedRunSummary[],
  truncated: boolean,
): InspectionDocument {
  return Object.freeze({
    protocol: QUERY_PROTOCOL,
    operation: "runs.list" as const,
    behaviorVersion: inspectionBehaviorVersion("runs.list"),
    source: sourceProvenance(source, cutoff),
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
  return encodeBase64UrlUtf8(JSON.stringify([
    CONTINUATION_PROTOCOL,
    "runs.list",
    inspectionBehaviorVersion("runs.list"),
    cutoffIdentity,
    afterRunId,
  ]));
}

function decodeContinuation(token: string): {
  readonly cutoffIdentity: string;
  readonly afterRunId: string;
} {
  try {
    const decoded = JSON.parse(decodeBase64UrlUtf8(token)) as unknown;
    if (!Array.isArray(decoded) || decoded.length !== 5 || decoded[0] !== CONTINUATION_PROTOCOL ||
      decoded[1] !== "runs.list" || decoded[2] !== inspectionBehaviorVersion("runs.list") ||
      typeof decoded[3] !== "string" || typeof decoded[4] !== "string") {
      throw new Error("continuation binding changed");
    }
    return Object.freeze({ cutoffIdentity: decoded[3], afterRunId: decoded[4] });
  } catch (cause) {
    throw operationFailure(
      "runs.list",
      "Continuation is invalid or its sealed cutoff changed; restart runs.list",
      cause,
    );
  }
}

function loadForOperation(source: InspectionFactSource, operation: InspectionOperation): {
  readonly selected: readonly LoadedInspectionRun[];
  readonly requestedRunIds: readonly string[];
  readonly missingRunIds: readonly string[];
} {
  if (operation.kind === "overview.get") {
    return { selected: loadInspectionRuns(source), requestedRunIds: [], missingRunIds: [] };
  }
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

function loadRuns(
  source: InspectionFactSource,
  runIds: readonly string[],
): readonly LoadedInspectionRun[] {
  const uniqueRunIds = [...new Set(runIds)];
  if (uniqueRunIds.length > RUN_SELECTION_LIMIT) {
    throw new Error(`Inspection selection exceeds the fixed ${RUN_SELECTION_LIMIT}-Run limit`);
  }
  return loadSelectedInspectionRuns(source, uniqueRunIds);
}

function loadReferencedOrigins(
  source: InspectionFactSource,
  targets: readonly LoadedInspectionRun[],
): readonly LoadedInspectionRun[] {
  const targetIds = new Set(targets.map(({ run }) => run.runId));
  const originIds = [...new Set(targets.flatMap(({ members }) => members.flatMap(({ attempt }) =>
    attempt === null || targetIds.has(attempt.originRunId) ? [] : [attempt.originRunId])))];
  return uniqueRuns([...targets, ...loadRuns(source, originIds)]);
}

function loadSummaryFacts(
  source: InspectionFactSource,
  target: LoadedInspectionRun,
): readonly LoadedInspectionRun[] {
  return loadReferencedOrigins(source, [target]);
}

function parseJson(bytes: Uint8Array): unknown {
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
}

function selectRuns(
  all: readonly LoadedInspectionRun[],
  runIds: readonly string[],
) {
  const byId = new Map<string, LoadedInspectionRun>(
    all.map((run) => [run.run.runId, run]),
  );
  const requested = [...new Set(runIds)];
  return Object.freeze({
    selected: Object.freeze(requested.flatMap((runId) => {
      const run = byId.get(runId);
      return run === undefined ? [] : [run];
    })),
    missing: Object.freeze(requested.filter((runId) => !byId.has(runId))),
  });
}

function requireOne(
  operation: InspectionOperationId,
  selected: readonly LoadedInspectionRun[],
  runId: string,
): LoadedInspectionRun {
  const run = selected[0];
  if (run === undefined) {
    throw selectionMissing(operation, `Run ${runId} was not found`);
  }
  return run;
}

function requireAttemptFromSource(
  source: InspectionFactSource,
  operation: InspectionOperationId,
  locator: string,
): ResolvedInspectionAttempt {
  const resolved = resolveInspectionAttempt(source, locator);
  if (resolved === undefined) {
    throw selectionMissing(
      operation,
      `Attempt ${locator} was not found or is ambiguous`,
    );
  }
  return resolved;
}

function attemptRuns(
  resolved: ResolvedInspectionAttempt,
): readonly LoadedInspectionRun[] {
  return uniqueRuns([resolved.origin, ...resolved.targets.map(({ run }) => run)]);
}

function traceAttachments(
  resolved: ResolvedInspectionAttempt,
): AttemptTraceAttachments {
  return Object.freeze({
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
  });
}

function attachmentValue(
  resolved: ResolvedInspectionAttempt,
  family: string,
): InspectionJson {
  const attachment = attemptAttachment(resolved, family);
  return attachment === undefined
    ? Object.freeze({ state: "not-recorded" })
    : Object.freeze({
        state: "available",
        value: attachment.value,
        collection: attachmentCollectionPage(resolved.origin.source, attachment),
      });
}

function runAttachmentValue(
  run: LoadedInspectionRun,
  family: string,
): InspectionJson {
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
  attachment: DecodedInspectionAttachment,
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

function assertionEvidence(
  resolved: ResolvedInspectionAttempt,
): InspectionJson {
  const attachment = attemptAttachment(resolved, NiceEvalRecordAttachments.assertions.family);
  return attachment === undefined
    ? Object.freeze({ state: "not-recorded" })
    : Object.freeze({
        state: "available",
        value: compactAssertionInspection(attachment.value),
        collection: attachmentCollectionPage(resolved.origin.source, attachment),
      });
}

function attemptDetail(resolved: ResolvedInspectionAttempt): InspectionJson {
  const assertions = readInspectionAssertions(resolved);
  return closeJson(Object.freeze({
    core: resolved.attempt,
    locator: resolved.locator,
    originRun: resolved.origin.run,
    targets: resolved.targets.map(({ run, member }) => Object.freeze({ runId: run.run.runId, member })),
    evidence: assertionEvidence(resolved),
    assertions: projectAttemptAssertionIndex(assertions),
    sections: attemptSections(resolved),
    verdict: attemptVerdict(resolved, assertions),
    score: assertionScore(
      assertions.state === "available" ? assertions.value.entries : [],
    ),
    evidenceCoverage: attemptEvidenceCoverage(resolved),
    limitations: attemptLimitations(
      resolved,
      assertions.state === "available" ? assertions.value.entries : [],
    ),
  }));
}

type AttemptSectionState = "available" | "not-recorded" | "partial" | "unavailable";

function attemptSections(
  resolved: ResolvedInspectionAttempt,
): InspectionJson {
  const assertions = attachmentSectionState(
    attemptAttachment(resolved, NiceEvalRecordAttachments.assertions.family),
    NiceEvalCurrentRecordAttachments.assertions.revision,
  );
  const conversation = attachmentSectionState(
    attemptAttachment(resolved, NiceEvalRecordAttachments.agentTurns.family),
    NiceEvalCurrentRecordAttachments.agentTurns.revision,
  );
  const commands = attachmentSectionState(
    attemptAttachment(resolved, NiceEvalRecordAttachments.sandboxCommands.family),
    NiceEvalCurrentRecordAttachments.sandboxCommands.revision,
  );
  const timing = attachmentSectionState(
    attemptAttachment(resolved, NiceEvalRecordAttachments.runnerActivities.attempt.family),
    NiceEvalCurrentRecordAttachments.runnerActivities.attempt.revision,
  );
  const diagnostics = attachmentSectionState(
    attemptAttachment(resolved, NiceEvalRecordAttachments.runnerDiagnostics.attempt.family),
    NiceEvalCurrentRecordAttachments.runnerDiagnostics.attempt.revision,
  );
  const sources = attachmentSectionState(
    runAttachment(resolved.origin, NiceEvalRecordAttachments.sources.family),
    NiceEvalCurrentRecordAttachments.sources.revision,
  );
  const diff = attachmentSectionState(
    attemptAttachment(resolved, NiceEvalRecordAttachments.fileChanges.family),
    NiceEvalCurrentRecordAttachments.fileChanges.revision,
  );
  const artifacts = attachmentSectionState(
    attemptAttachment(resolved, NiceEvalRecordAttachments.artifacts.attempt.family),
    NiceEvalCurrentRecordAttachments.artifacts.attempt.revision,
  );
  return closeJson(Object.freeze({
    assertions: Object.freeze({ state: assertions }),
    trace: Object.freeze({ state: combineSectionStates([conversation, commands, timing, diagnostics]) }),
    sources: Object.freeze({ state: sources }),
    diff: Object.freeze({ state: diff }),
    artifacts: Object.freeze({ state: artifacts }),
    timing: Object.freeze({ state: timing }),
    usage: Object.freeze({ state: conversation }),
    conversation: Object.freeze({ state: conversation }),
    commands: Object.freeze({ state: commands }),
    diagnostics: Object.freeze({ state: diagnostics }),
  }));
}

function attachmentSectionState(
  attachment: DecodedInspectionAttachment | undefined,
  currentRevision: number,
): AttemptSectionState {
  if (attachment === undefined) return "not-recorded";
  if (attachment.physical.familyRevision !== currentRevision) return "unavailable";
  return containsState(attachment.value, "partial") ? "partial" : "available";
}

function combineSectionStates(states: readonly AttemptSectionState[]): AttemptSectionState {
  if (states.some((state) => state === "partial")) return "partial";
  if (states.some((state) => state === "available")) return "available";
  if (states.some((state) => state === "unavailable")) return "unavailable";
  return "not-recorded";
}

function containsState(value: InspectionJson, expected: string): boolean {
  if (Array.isArray(value)) return value.some((entry) => containsState(entry, expected));
  if (typeof value !== "object" || value === null) return false;
  const record = value as Readonly<Record<string, InspectionJson>>;
  return record.state === expected || Object.values(record).some((entry) => containsState(entry, expected));
}

function runSummary(
  all: readonly LoadedInspectionRun[],
  selected: LoadedInspectionRun,
): InspectionJson {
  const slots = selected.run.expectedSlots.map((slot) => {
    const member = selected.members.find((candidate) => candidate.slotId === slot.slotId);
    if (member === undefined || member.attempt === null) {
      return Object.freeze({
        runId: selected.run.runId, ...slot, state: member?.action ?? "missing", locator: null,
        outcome: null, verdict: null, usage: Object.freeze({ inputTokens: 0, outputTokens: 0 }),
      });
    }
    const resolved = resolveInspectionMemberAttempt(all, selected, member);
    if (resolved === undefined) {
      return Object.freeze({
        runId: selected.run.runId, ...slot, state: "missing", locator: null,
        outcome: null, verdict: null, usage: Object.freeze({ inputTokens: 0, outputTokens: 0 }),
      });
    }
    const assertions = readInspectionAssertions(resolved);
    return Object.freeze({
      runId: selected.run.runId, ...slot, state: member.action, locator: resolved.locator,
      outcome: resolved.attempt.outcome,
      verdict: attemptVerdict(resolved, assertions),
      score: assertionScore(
        assertions.state === "available" ? assertions.value.entries : [],
      ),
      evidenceCoverage: attemptEvidenceCoverage(resolved),
      limitations: attemptLimitations(
        resolved,
        assertions.state === "available" ? assertions.value.entries : [],
      ),
      usage: attemptUsage(resolved),
    });
  });
  return closeJson(Object.freeze({
    runs: Object.freeze([selected.run]),
    denominator: Object.freeze({ expected: slots.length, observed: slots.filter(({ locator }) => locator !== null).length }),
    members: Object.freeze(slots),
  }));
}

function attemptVerdict(
  resolved: ResolvedInspectionAttempt,
  assertions = readInspectionAssertions(resolved),
): string | null {
  if (assertions.state === "available") {
    return foldRecordedAttemptVerdict({
      outcome: resolved.attempt.outcome,
      assertions: assertions.value,
    });
  }
  if (assertions.state !== "failed" || assertions.attachment === undefined) {
    return null;
  }
  if (resolved.attempt.outcome === "errored" || resolved.attempt.outcome === "interrupted") return "errored";
  if (containsRequiredAssertionError(assertions.attachment.value)) return "errored";
  return containsFailedDecision(assertions.attachment.value) ? "failed" : null;
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

function attemptEvidenceCoverage(
  resolved: ResolvedInspectionAttempt,
): InspectionJson {
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
  resolved: ResolvedInspectionAttempt,
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

function attemptUsage(resolved: ResolvedInspectionAttempt) {
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
  all: readonly LoadedInspectionRun[],
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

function comparisonMembers(
  all: readonly LoadedInspectionRun[],
  runs: readonly LoadedInspectionRun[],
) {
  return runs.flatMap((run) => run.members.flatMap((member) => {
    if (member.attempt === null) return [];
    const slot = run.run.expectedSlots.find(({ slotId }) => slotId === member.slotId);
    const resolved = resolveInspectionMemberAttempt(all, run, member);
    if (slot === undefined || resolved === undefined) return [];
    return [Object.freeze({
      key: `${run.run.experimentId}\u0000${slot.evalId}\u0000${slot.attemptOrdinal}`,
      runId: run.run.runId, slotId: slot.slotId, evalId: slot.evalId, attemptOrdinal: slot.attemptOrdinal,
      locator: resolved.locator,
    })];
  }));
}

function baseDocument(
  source: InspectionFactSource,
  operation: InspectionOperationId,
  selectedInput: readonly LoadedInspectionRun[],
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
    source: sourceProvenance(source, cutoff),
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

function locators(runs: readonly LoadedInspectionRun[]): readonly string[] {
  return Object.freeze(runs.flatMap(({ attempts }) => attempts.map(({ attemptId }) => encodeAttemptLocator(attemptId))));
}

function uniqueRuns(
  runs: readonly LoadedInspectionRun[],
): readonly LoadedInspectionRun[] {
  return Object.freeze([...new Map(runs.map((run) => [run.run.runId, run] as const)).values()]);
}

function factKinds(operation: InspectionOperationId): readonly string[] {
  switch (operation) {
    case "overview.get": return Object.freeze(["core", "assertions"]);
    case "runs.list":
    case "run.get": return Object.freeze(["core"]);
    case "run.summary": return Object.freeze(["core", "assertions", "agent-turns"]);
    case "attempt.get": return Object.freeze(["core", "assertions"]);
    case "attempt.assertion.detail": return Object.freeze(["assertions", "agent-turns", "sources"]);
    case "attempt.trace": return Object.freeze(["agent-turns", "turn-contexts", "sandbox-commands", "runner-activities", "runner-diagnostics"]);
    case "attempt.trace.detail": return Object.freeze(["agent-turns", "sandbox-commands"]);
    case "attempt.diff": return Object.freeze(["file-changes"]);
    case "attempt.sources": return Object.freeze(["assertions", "sources"]);
    case "attempt.artifacts": return Object.freeze(["artifacts"]);
    case "runs.compare": return Object.freeze(["core", "assertions", "agent-turns"]);
  }
}

function closeJson(value: unknown): InspectionJson {
  const closed = closeInspectionJson(value);
  if (typeof closed === "object" && closed !== null && !Array.isArray(closed) && Reflect.get(closed, "code") === "inspection-result-invalid") {
    throw closed;
  }
  return closed as InspectionJson;
}

function boundedJson(value: unknown): InspectionJson {
  const closed = closeJson(value);
  const byteLength = utf8ByteLength(JSON.stringify(closed));
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

function sourceProvenance(
  source: InspectionFactSource,
  cutoff: SealedRunCutoff,
): InspectionSourceProvenance {
  return Object.freeze({
    kind: source.kind,
    sealedCutoffIdentity: cutoff.identity,
  });
}

function evaluateInspectionOperation<A>(
  operation: InspectionOperationId,
  evaluate: () => A,
): A {
  try {
    return evaluate();
  } catch (cause) {
    if (cause instanceof InspectionOperationError) throw cause;
    if (isInspectionResultError(cause)) throw cause;
    throw operationFailure(operation, "Inspection operation failed", cause);
  }
}

function isInspectionResultError(
  value: unknown,
): value is { readonly code: "inspection-result-invalid"; readonly reason: string } {
  return typeof value === "object" && value !== null &&
    Reflect.get(value, "code") === "inspection-result-invalid" &&
    typeof Reflect.get(value, "reason") === "string";
}

function selectionMissing(
  operation: InspectionOperationId,
  reason: string,
  cause?: unknown,
): InspectionOperationError {
  return new InspectionOperationError({
    code: "inspection-selection-missing",
    operation,
    reason,
    ...(cause === undefined ? {} : { cause }),
  });
}

function operationFailure(
  operation: InspectionOperationId,
  reason: string,
  cause?: unknown,
): InspectionOperationError {
  return new InspectionOperationError({
    code: "inspection-operation-failed",
    operation,
    reason,
    ...(cause === undefined ? {} : { cause }),
  });
}
