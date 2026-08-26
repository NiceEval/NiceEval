/// <reference lib="webworker" />

import sqlite3InitModule, { type Database, type SqlValue } from "@sqlite.org/sqlite-wasm";
import { Either } from "effect";

import { assertionsRecordAttachment } from "../../../record/family/assertions/definition.ts";
import { sourcesRecordAttachment } from "../../../record/family/sources/definition.ts";
import { agentTurnsRecordAttachment } from "../../../record/family/agent-turns/definition.ts";
import {
  attemptRunnerActivitiesRecordAttachment,
  runRunnerActivitiesRecordAttachment,
} from "../../../record/family/runner-activities/definition.ts";
import { sandboxCommandsRecordAttachment } from "../../../record/family/sandbox-commands/definition.ts";
import {
  attemptRunnerDiagnosticsRecordAttachment,
  runRunnerDiagnosticsRecordAttachment,
} from "../../../record/family/runner-diagnostics/definition.ts";
import { fileChangesRecordAttachment } from "../../../record/family/file-changes/definition.ts";
import {
  attemptArtifactsRecordAttachment,
  runArtifactsRecordAttachment,
} from "../../../record/family/artifacts/definition.ts";
import {
  enumerateRecordAttachmentClosure,
  hydrateRecordAttachmentCurrent,
  mintRecordAttachmentReference,
  RecordAttachmentReference,
} from "../../../record/attachment/protocol.ts";
import { mintRecordContentHandle } from "../../../record/attachment/content.ts";

import type {
  ActivityResult as ActivityView,
  ArtifactResult as ArtifactView,
  AssertionResult as AssertionView,
  AttemptQueryResult,
  AttemptResult as AttemptView,
  AttemptSummaryResult,
  ArtifactsResult,
  CatalogResult,
  CommandResult as CommandView,
  CollectionState,
  CompareResult,
  CoverageResult as CoverageView,
  DiagnosticResult as DiagnosticView,
  ExperimentSummaryResult,
  FamilyStatusResult,
  FileChangeResult as FileChangeView,
  FileEndpointResult,
  MembershipAction,
  OverviewResult,
  RunResult,
  SourceResult as SourceView,
  SourcesResult,
  TrajectoryItemResult as TrajectoryItemView,
  TurnResult as TurnView,
  UsageResult as UsageView,
  ViewQueryName,
} from "../../query.ts";
import { RECORD_SQLITE_FORMAT, RECORD_SQLITE_STORAGE_REVISION } from "../../../record/sqlite/types.ts";
import type { WorkerRequest, WorkerResponse } from "./protocol.ts";

type Row = Record<string, SqlValue>;
type JsonObject = Record<string, unknown>;

interface AttachmentRow {
  readonly attachmentId: string;
  readonly ownerKind: string;
  readonly ownerRunId: string;
  readonly ownerAttemptId?: string;
  readonly family: string;
  readonly familyRevision: number;
  readonly payload: JsonObject;
  readonly contents: ReadonlyMap<string, Uint8Array>;
}

const worker = self as unknown as DedicatedWorkerGlobalScope;
const decoder = new TextDecoder();
let database: Database | undefined;

worker.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  const operation = request.kind === "open"
    ? openSnapshot(request.bytes).then((): WorkerResponse => ({ id: request.id, ok: true, kind: "ready" }))
    : Promise.resolve().then((): WorkerResponse => ({
      id: request.id,
      ok: true,
      kind: "result",
      name: request.name,
      result: runNamedQuery(request.name, request.input),
    }));
  void operation.then(
    (response) => post(response),
    (cause: unknown) => post({
      id: request.id,
      ok: false,
      error: cause instanceof Error ? cause.message : "The sealed Record snapshot could not be read.",
    }),
  );
};

function post(response: WorkerResponse): void {
  worker.postMessage(response);
}

async function openSnapshot(buffer: ArrayBuffer): Promise<void> {
  const sqlite3 = await sqlite3InitModule();
  const db = new sqlite3.oo1.DB(":memory:", "c");
  const bytes = new Uint8Array(buffer);
  const pointer = sqlite3.wasm.allocFromTypedArray(bytes);
  let transferred = false;
  try {
    if (db.pointer === undefined) throw new Error("SQLite opened without a database pointer.");
    const result = sqlite3.capi.sqlite3_deserialize(
      db.pointer,
      "main",
      pointer,
      bytes.byteLength,
      bytes.byteLength,
      sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE | sqlite3.capi.SQLITE_DESERIALIZE_READONLY,
    );
    if (result !== sqlite3.capi.SQLITE_OK) {
      throw new Error(`SQLite rejected the Record snapshot (${result}).`);
    }
    transferred = true;
    assertCurrentRecordSnapshot(db);
    database?.close();
    database = db;
    return;
  } finally {
    if (database !== db) db.close();
    if (!transferred) sqlite3.wasm.dealloc(pointer);
  }
}

function assertCurrentRecordSnapshot(db: Database): void {
  const rows = query(db, `
    SELECT format, storage_revision, artifact_kind
    FROM record_metadata
    WHERE singleton = 1
  `);
  const row = rows[0];
  if (row === undefined) throw migrationRequired("Record metadata is missing");
  const format = sqlText(row.format, "record_metadata.format");
  if (format !== RECORD_SQLITE_FORMAT) {
    throw migrationRequired(`Record format ${JSON.stringify(format)} is not ${JSON.stringify(RECORD_SQLITE_FORMAT)}`);
  }
  const revision = integer(row.storage_revision, "record_metadata.storage_revision");
  if (revision !== RECORD_SQLITE_STORAGE_REVISION) {
    throw migrationRequired(`Record storage revision ${revision} is not current revision ${RECORD_SQLITE_STORAGE_REVISION}`);
  }
  if (sqlText(row.artifact_kind, "record_metadata.artifact_kind") !== "snapshot") {
    throw migrationRequired("Record artifact is not a RecordSnapshot");
  }
}

function migrationRequired(reason: string): Error {
  return new Error(`${reason}. Run niceeval record migrate on the live Record and generate a new RecordSnapshot.`);
}

interface InternalMember {
  readonly slotId: string;
  readonly evalId: string;
  readonly action: MembershipAction;
  readonly attemptKey?: string;
}

interface InternalRun {
  readonly runId: string;
  readonly experimentId: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly members: readonly InternalMember[];
}

interface InternalExperiment {
  readonly experimentId: string;
  readonly runs: readonly InternalRun[];
  readonly evalIds: readonly string[];
  readonly attempts: number;
  readonly passed: number;
}

interface CurrentBusinessRows {
  readonly experiments: readonly InternalExperiment[];
  readonly runs: readonly InternalRun[];
  readonly attempts: readonly AttemptView[];
  readonly defaultExperimentId?: string;
}

function readCurrentBusinessRows(db: Database): CurrentBusinessRows {
  const runDocuments = new Map<string, JsonObject>();
  for (const row of query(db, `
    SELECT run_id, started_at, core_payload
    FROM runs
    WHERE status = 'sealed'
    ORDER BY started_at DESC, run_id ASC
  `)) {
    runDocuments.set(sqlText(row.run_id, "runs.run_id"), jsonObject(row.core_payload, "runs.core_payload"));
  }

  const attemptsByKey = new Map<string, AttemptView>();
  const attemptDocuments = new Map<string, JsonObject>();
  const locatorByKey = new Map<string, string>();
  for (const row of query(db, `
    SELECT a.origin_run_id, a.attempt_id, a.attempt_locator, a.core_payload
    FROM attempts a
    JOIN runs r ON r.run_id = a.origin_run_id
    WHERE r.status = 'sealed'
    ORDER BY a.origin_run_id, a.attempt_id
  `)) {
    const key = attemptKey(sqlText(row.origin_run_id, "attempts.origin_run_id"), sqlText(row.attempt_id, "attempts.attempt_id"));
    attemptDocuments.set(key, jsonObject(row.core_payload, "attempts.core_payload"));
    locatorByKey.set(key, sqlText(row.attempt_locator, "attempts.attempt_locator"));
  }

  const attachments = readAttachments(db);
  const attempts = [...attemptDocuments].map(([key, document]) => {
    const originRunId = requiredJsonString(document, "originRunId");
    const attemptId = requiredJsonString(document, "attemptId");
    const owned = attachments.filter((attachment) =>
      attachment.ownerKind === "attempt" &&
      attachment.ownerRunId === originRunId &&
      attachment.ownerAttemptId === attemptId
    );
    const runOwned = attachments.filter((attachment) =>
      attachment.ownerKind === "run" && attachment.ownerRunId === originRunId
    );
    const assertionsAttachment = family(owned, "niceeval.assertions");
    const assertions = assertionViews(assertionsAttachment?.payload);
    const turnsAttachment = family(owned, "niceeval.agent-turns");
    const turns = turnViews(turnsAttachment?.payload);
    const sourcesAttachment = family(runOwned, "niceeval.sources");
    const activitiesAttachment = family(owned, "niceeval.runner-activities");
    const commandsAttachment = family(owned, "niceeval.sandbox-commands");
    const diagnosticsAttachment = family(owned, "niceeval.runner-diagnostics");
    const fileChangesAttachment = family(owned, "niceeval.file-changes");
    const artifactsAttachment = family(owned, "niceeval.artifacts");
    const result = Object.freeze({
      key,
      attemptId,
      locator: requiredMapValue(locatorByKey, key, "Attempt locator"),
      originRunId,
      evalId: requiredJsonString(document, "evalId"),
      outcome: requiredEnum(document.outcome, "Attempt.outcome", ["completed", "errored", "cancelled", "interrupted"] as const),
      verdict: verdictFor(document, assertionsAttachment?.payload),
      ...scoreFor(assertions),
      assertionsStatus: presenceStatus(assertionsAttachment),
      assertions,
      sourcesStatus: presenceStatus(sourcesAttachment),
      sources: sourceViews(sourcesAttachment),
      turnsStatus: collectionStatus(turnsAttachment),
      turns,
      coverage: coverageViews(turnsAttachment?.payload),
      usage: usageViews(turnsAttachment?.payload),
      activitiesStatus: collectionStatus(activitiesAttachment),
      activities: activityViews(activitiesAttachment?.payload),
      commandsStatus: collectionStatus(commandsAttachment),
      commands: commandViews(commandsAttachment),
      diagnosticsStatus: collectionStatus(diagnosticsAttachment),
      diagnostics: diagnosticViews(diagnosticsAttachment?.payload),
      fileChangesStatus: collectionStatus(fileChangesAttachment),
      fileChanges: fileChangeViews(fileChangesAttachment),
      artifactsStatus: collectionStatus(artifactsAttachment),
      artifacts: artifactViews(artifactsAttachment?.payload),
      artifactsState: collectionState(artifactsAttachment?.payload),
      issues: attachmentIssues(owned),
    } satisfies AttemptView);
    attemptsByKey.set(key, result);
    return result;
  });

  const membersByRun = new Map<string, InternalMember[]>();
  for (const row of query(db, `
    SELECT m.target_run_id, m.slot_id, m.action, m.origin_run_id, m.attempt_id, m.core_payload
    FROM members m
    JOIN runs r ON r.run_id = m.target_run_id
    WHERE r.status = 'sealed'
    ORDER BY m.target_run_id, m.slot_id
  `)) {
    const targetRunId = sqlText(row.target_run_id, "members.target_run_id");
    const runDocument = requiredMapValue(runDocuments, targetRunId, "Member target Run");
    const slotId = sqlText(row.slot_id, "members.slot_id");
    const expectedSlot = requiredObject(requiredArray(runDocument, "expectedSlots")
      .map((value, index) => requiredObject(value, `Run expectedSlots[${index}]`))
      .find((slot) => slot.slotId === slotId), `Expected Slot ${slotId}`);
    const origin = nullableText(row.origin_run_id);
    const attemptId = nullableText(row.attempt_id);
    const member: InternalMember = Object.freeze({
      slotId,
      evalId: requiredJsonString(expectedSlot, "evalId"),
      action: requiredEnum(sqlText(row.action, "members.action"), "members.action", [
        "executed", "carried", "accepted", "not-dispatched", "interrupted",
      ] as const),
      ...(origin !== undefined && attemptId !== undefined
        ? { attemptKey: attemptKey(origin, attemptId) }
        : {}),
    });
    const list = membersByRun.get(targetRunId) ?? [];
    list.push(member);
    membersByRun.set(targetRunId, list);
  }

  const runs: InternalRun[] = [...runDocuments].map(([runId, document]) => Object.freeze({
    runId,
    experimentId: requiredJsonString(document, "experimentId"),
    startedAt: utcMillisText(document, "startedAt", `Run ${runId}`),
    completedAt: utcMillisText(document, "completedAt", `Run ${runId}`),
    members: Object.freeze(membersByRun.get(runId) ?? []),
  }));

  const experiments = experimentViews(runs, attemptsByKey);
  const defaultExperimentId = [...experiments]
    .sort((left, right) => right.runs.length - left.runs.length || left.experimentId.localeCompare(right.experimentId))[0]
    ?.experimentId;
  return Object.freeze({
    experiments,
    runs: Object.freeze(runs),
    attempts: Object.freeze(attempts),
    ...(defaultExperimentId === undefined ? {} : { defaultExperimentId }),
  });
}

function runNamedQuery(name: ViewQueryName, input: unknown): unknown {
  const db = database;
  if (db === undefined) throw new Error("RecordSnapshot repository is not open.");
  const rows = readCurrentBusinessRows(db);
  switch (name) {
    case "catalog": return catalogResult(rows);
    case "overview": return overviewResult(rows, optionalInputString(input, "experimentId"));
    case "run": return runResult(rows, requiredInputString(input, "runId"));
    case "attempt": return attemptResult(rows, requiredInputString(input, "locator"));
    case "sources": return sourcesResult(rows, requiredInputString(input, "locator"));
    case "artifacts": return artifactsResult(rows, requiredInputString(input, "locator"));
    case "compare": return compareResult(rows);
  }
}

function catalogResult(rows: CurrentBusinessRows): CatalogResult {
  return Object.freeze({
    experiments: Object.freeze(rows.experiments.map(({ experimentId }) => experimentId)),
    ...(rows.defaultExperimentId === undefined ? {} : { defaultExperimentId: rows.defaultExperimentId }),
    runExperiments: Object.freeze(rows.runs.map((run) => Object.freeze({ runId: run.runId, experimentId: run.experimentId }))),
    attemptExperiments: Object.freeze(rows.attempts.map((attempt) => Object.freeze({
      locator: attempt.locator,
      experimentId: requiredRun(rows.runs, attempt.originRunId).experimentId,
    }))),
  });
}

function overviewResult(rows: CurrentBusinessRows, requestedExperimentId: string | undefined): OverviewResult {
  const selectedExperimentId = requestedExperimentId ?? rows.defaultExperimentId;
  const selected = rows.experiments.find((experiment) => experiment.experimentId === selectedExperimentId);
  if (requestedExperimentId !== undefined && selected === undefined) {
    throw new Error(`Experiment ${JSON.stringify(requestedExperimentId)} is not present in this RecordSnapshot.`);
  }
  const attemptsByKey = new Map(rows.attempts.map((attempt) => [attempt.key, attempt] as const));
  const selectedAttempts = selected?.runs.flatMap((run) => run.members.flatMap((member) => {
    const attempt = member.attemptKey === undefined ? undefined : attemptsByKey.get(member.attemptKey);
    return attempt === undefined ? [] : [attempt];
  })) ?? [];
  return Object.freeze({
    experiments: Object.freeze(rows.experiments.map((experiment): ExperimentSummaryResult => Object.freeze({
      experimentId: experiment.experimentId,
      runCount: experiment.runs.length,
      evalCount: experiment.evalIds.length,
      attempts: experiment.attempts,
      passed: experiment.passed,
    }))),
    ...(selected === undefined ? {} : { selectedExperimentId: selected.experimentId }),
    evalIds: Object.freeze(selected?.evalIds ?? []),
    runs: Object.freeze(selected?.runs.map((run) => publicRun(run, attemptsByKey)) ?? []),
    attempts: selected?.attempts ?? 0,
    passed: selected?.passed ?? 0,
    totalCost: selectedAttempts.flatMap((attempt) => attempt.usage)
      .filter((usage) => usage.kind === "provider-cost")
      .reduce((total, usage) => total + currentCostAmount(usage.value), 0),
  });
}

function publicRun(run: InternalRun, attempts: ReadonlyMap<string, AttemptView>) {
  return Object.freeze({
    runId: run.runId,
    experimentId: run.experimentId,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    members: Object.freeze(run.members.map((member) => {
      const attempt = member.attemptKey === undefined ? undefined : attempts.get(member.attemptKey);
      return Object.freeze({
        slotId: member.slotId,
        evalId: member.evalId,
        action: member.action,
        ...(attempt === undefined ? {} : { attempt: attemptSummary(attempt) }),
      });
    })),
  });
}

function attemptSummary(attempt: AttemptView): AttemptSummaryResult {
  return Object.freeze({
    key: attempt.key,
    attemptId: attempt.attemptId,
    locator: attempt.locator,
    originRunId: attempt.originRunId,
    evalId: attempt.evalId,
    outcome: attempt.outcome,
    verdict: attempt.verdict,
    scoreState: attempt.scoreState,
    scoreEarned: attempt.scoreEarned,
    scorePossible: attempt.scorePossible,
    coverage: attempt.coverage,
    issues: attempt.issues,
  });
}

function runResult(rows: CurrentBusinessRows, runId: string): RunResult {
  const run = rows.runs.find((candidate) => candidate.runId === runId);
  if (run === undefined) return Object.freeze({});
  return Object.freeze({ run: publicRun(run, new Map(rows.attempts.map((attempt) => [attempt.key, attempt] as const))) });
}

function attemptResult(rows: CurrentBusinessRows, locator: string): AttemptQueryResult {
  const attempt = rows.attempts.find((candidate) => candidate.locator === locator);
  return Object.freeze(attempt === undefined ? {} : { attempt });
}

function sourcesResult(rows: CurrentBusinessRows, locator: string): SourcesResult {
  const attempt = rows.attempts.find((candidate) => candidate.locator === locator);
  if (attempt === undefined) throw new Error(`Attempt ${JSON.stringify(locator)} is not present in this RecordSnapshot.`);
  return Object.freeze({ locator, status: attempt.sourcesStatus, sources: attempt.sources });
}

function artifactsResult(rows: CurrentBusinessRows, locator: string): ArtifactsResult {
  const attempt = rows.attempts.find((candidate) => candidate.locator === locator);
  if (attempt === undefined) throw new Error(`Attempt ${JSON.stringify(locator)} is not present in this RecordSnapshot.`);
  return Object.freeze({
    locator,
    state: attempt.artifactsState,
    status: attempt.artifactsStatus,
    artifacts: attempt.artifacts,
  });
}

function compareResult(rows: CurrentBusinessRows): CompareResult {
  return Object.freeze({ experiments: Object.freeze(rows.experiments.map((experiment) => Object.freeze({
    experimentId: experiment.experimentId,
    runs: Object.freeze(experiment.runs.map(({ runId }) => Object.freeze({ runId }))),
  }))) });
}

function requiredInputString(input: unknown, key: string): string {
  const value = object(input)?.[key];
  if (typeof value !== "string" || value.length === 0) throw new Error(`View query requires ${key}.`);
  return value;
}

function optionalInputString(input: unknown, key: string): string | undefined {
  const value = object(input)?.[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length === 0) throw new Error(`View query ${key} must be a non-empty string.`);
  return value;
}

function readAttachments(db: Database): readonly AttachmentRow[] {
  const content = new Map<string, Map<string, Uint8Array[]>>();
  for (const row of query(db, `
    SELECT c.attachment_id, c.logical_handle, ch.ordinal, ch.bytes
    FROM contents c
    JOIN content_chunks ch ON ch.content_id = c.content_id
    ORDER BY c.attachment_id, c.logical_handle, ch.ordinal
  `)) {
    const attachmentId = sqlText(row.attachment_id, "contents.attachment_id");
    const byHandle = content.get(attachmentId) ?? new Map<string, Uint8Array[]>();
    const handle = sqlText(row.logical_handle, "contents.logical_handle");
    const chunks = byHandle.get(handle) ?? [];
    chunks.push(blob(row.bytes));
    byHandle.set(handle, chunks);
    content.set(attachmentId, byHandle);
  }
  return Object.freeze(query(db, `
    SELECT a.attachment_id, a.owner_kind, a.owner_run_id, a.owner_attempt_id,
           a.family, a.family_revision, a.canonical_payload
    FROM attachments a
    JOIN runs r ON r.run_id = a.owner_run_id
    WHERE r.status = 'sealed' AND a.canonical_payload IS NOT NULL
    ORDER BY a.owner_run_id, a.owner_attempt_id, a.family
  `).map((row): AttachmentRow => {
    const attachmentId = sqlText(row.attachment_id, "attachments.attachment_id");
    const joined = new Map<string, Uint8Array>();
    for (const [handle, chunks] of content.get(attachmentId) ?? []) {
      const size = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      joined.set(handle, bytes);
    }
    const familyName = sqlText(row.family, "attachments.family");
    const familyRevision = integer(row.family_revision, "attachments.family_revision");
    assertCurrentFamilyRevision(familyName, familyRevision);
    const attachment = Object.freeze({
      attachmentId,
      ownerKind: sqlText(row.owner_kind, "attachments.owner_kind"),
      ownerRunId: sqlText(row.owner_run_id, "attachments.owner_run_id"),
      ...(nullableText(row.owner_attempt_id) === undefined ? {} : { ownerAttemptId: nullableText(row.owner_attempt_id) }),
      family: familyName,
      familyRevision,
      payload: jsonObject(row.canonical_payload, "attachments.canonical_payload"),
      contents: joined,
    });
    validateCurrentAttachment(attachment);
    return attachment;
  }));
}

function query(db: Database, sql: string): Row[] {
  return db.exec(sql, { rowMode: "object", returnValue: "resultRows" }) as Row[];
}

function family(rows: readonly AttachmentRow[], name: string): AttachmentRow | undefined {
  return rows.find((row) => row.family === name);
}

function assertCurrentFamilyRevision(familyName: string, revision: number): void {
  const expected = currentFamilyRevisions[familyName as keyof typeof currentFamilyRevisions];
  if (expected !== undefined && revision !== expected) {
    throw migrationRequired(`${familyName} revision ${revision} is not current revision ${expected}`);
  }
}

const currentFamilyRevisions = {
  "niceeval.assertions": 4,
  "niceeval.sources": 2,
  "niceeval.agent-turns": 4,
  "niceeval.runner-activities": 2,
  "niceeval.sandbox-commands": 2,
  "niceeval.runner-diagnostics": 2,
  "niceeval.file-changes": 2,
  "niceeval.artifacts": 2,
} as const;

function validateCurrentAttachment(attachment: AttachmentRow): void {
  const definition = currentAttachmentDefinition(attachment.ownerKind, attachment.family);
  if (definition === undefined) return;
  const usedHandles = new Set<string>();
  const hydrated = hydrateRecordAttachmentCurrent(definition, attachment.payload, {
    content: (token, declaration) => {
      const handle = exactMarker(token, "$niceeval.record.content");
      if (typeof handle !== "string") return Either.left({ code: "current-content-bind-failed" as const });
      const bytes = attachment.contents.get(handle);
      if (
        bytes === undefined ||
        usedHandles.has(handle) ||
        declaration.maximumBytes !== undefined && bytes.byteLength > declaration.maximumBytes
      ) return Either.left({ code: "current-content-bind-failed" as const });
      usedHandles.add(handle);
      return Either.right(mintRecordContentHandle(declaration.kind));
    },
    reference: (token, declaration) => {
      const marker = exactMarker(token, "$niceeval.record.reference");
      const value = object(marker);
      if (
        value === undefined ||
        Reflect.ownKeys(value).length !== 3 ||
        value.owner !== declaration.definition.owner ||
        value.family !== declaration.definition.family ||
        !("value" in value)
      ) return Either.left({ code: "current-reference-bind-failed" as const });
      try {
        return Either.right(mintRecordAttachmentReference(
          RecordAttachmentReference.to(declaration.definition, declaration.valueSchema),
          value.value,
        ));
      } catch {
        return Either.left({ code: "current-reference-bind-failed" as const });
      }
    },
  });
  if (Either.isLeft(hydrated)) {
    throw migrationRequired(`${attachment.family} current schema validation failed (${hydrated.left.code})`);
  }
  const closure = enumerateRecordAttachmentClosure(definition, hydrated.right);
  if (
    Either.isLeft(closure) ||
    usedHandles.size !== attachment.contents.size ||
    (Either.isRight(closure) && closure.right.contents.length !== usedHandles.size)
  ) {
    throw migrationRequired(`${attachment.family} current closure validation failed`);
  }
}

function currentAttachmentDefinition(ownerKind: string, familyName: string) {
  if (ownerKind === "attempt") {
    if (familyName === "niceeval.assertions") return assertionsRecordAttachment;
    if (familyName === "niceeval.agent-turns") return agentTurnsRecordAttachment;
    if (familyName === "niceeval.runner-activities") return attemptRunnerActivitiesRecordAttachment;
    if (familyName === "niceeval.sandbox-commands") return sandboxCommandsRecordAttachment;
    if (familyName === "niceeval.runner-diagnostics") return attemptRunnerDiagnosticsRecordAttachment;
    if (familyName === "niceeval.file-changes") return fileChangesRecordAttachment;
    if (familyName === "niceeval.artifacts") return attemptArtifactsRecordAttachment;
  }
  if (ownerKind === "run") {
    if (familyName === "niceeval.sources") return sourcesRecordAttachment;
    if (familyName === "niceeval.runner-activities") return runRunnerActivitiesRecordAttachment;
    if (familyName === "niceeval.runner-diagnostics") return runRunnerDiagnosticsRecordAttachment;
    if (familyName === "niceeval.artifacts") return runArtifactsRecordAttachment;
  }
  return undefined;
}

function exactMarker(value: unknown, marker: string): unknown {
  const candidate = object(value);
  return candidate !== undefined && Reflect.ownKeys(candidate).length === 1 && marker in candidate
    ? candidate[marker]
    : undefined;
}

function assertionViews(payload: JsonObject | undefined): readonly AssertionView[] {
  if (payload === undefined) return Object.freeze([]);
  return Object.freeze(requiredArray(payload, "entries-data").map((value, index) => {
    const path = `Assertions entries-data[${index}]`;
    const entry = requiredObject(value, path);
    const display = requiredObject(entry.display, `${path}.display`);
    const contribution = requiredObject(entry.contribution, `${path}.contribution`);
    const contributionState = requiredEnum(
      contribution.state,
      `${path}.contribution.state`,
      ["not-scored", "earned", "unavailable"] as const,
    );
    const criterion = requiredObject(entry.criterion, `${path}.criterion`);
    const criterionState = requiredEnum(criterion.state, `${path}.criterion.state`, ["available", "unavailable"] as const);
    const materials = requiredObject(entry.materials, `${path}.materials`);
    const coverage = requiredObject(materials.coverage, `${path}.materials.coverage`);
    const coverageState = requiredEnum(
      coverage.state,
      `${path}.materials.coverage.state`,
      ["complete", "partial", "unavailable"] as const,
    );
    const limitations = Object.freeze(requiredArray(materials, "limitations").map((value, limitationIndex) => {
      const limitationPath = `${path}.materials.limitations[${limitationIndex}]`;
      const limitation = requiredObject(value, limitationPath);
      const kind = requiredJsonString(limitation, "kind", limitationPath);
      const summary = JSON.stringify(limitation);
      if (summary === undefined) throw migrationRequired(`${limitationPath} is not JSON`);
      return Object.freeze({ kind, summary });
    }));
    const evaluation = requiredObject(entry.evaluation, `${path}.evaluation`);
    const observed = requiredObject(evaluation.observed, `${path}.evaluation.observed`);
    const policy = requiredObject(entry.policy, `${path}.policy`);
    const condition = requiredObject(policy.condition, `${path}.policy.condition`);
    const conditionValue = condition.state === "available"
      ? requiredObject(condition.value, `${path}.policy.condition.value`)
      : undefined;
    const points = optionalJsonNumber(contribution, "points", `${path}.contribution.points`);
    const earned = optionalJsonNumber(contribution, "earned", `${path}.contribution.earned`);
    const label = optionalJsonString(display, "label", `${path}.display.label`)
      ?? optionalJsonString(display, "key", `${path}.display.key`)
      ?? requiredJsonString(entry, "entryId", path);
    return Object.freeze({
      id: requiredJsonString(entry, "entryId", path),
      label,
      state: requiredEnum(
        requiredObject(entry.decision, `${path}.decision`).result,
        `${path}.decision.result`,
        ["matched", "mismatched", "unavailable", "errored", "not-applicable"] as const,
      ),
      criterionState: criterionState === "available" ? "available" : "not-recorded",
      coverageState,
      contributionState,
      limitations,
      ...(points === undefined ? {} : { points }),
      ...(earned === undefined ? {} : { earned }),
      ...(factText(observed) === undefined ? {} : { observed: factText(observed) }),
      ...(conditionValue === undefined || optionalJsonNumber(conditionValue, "threshold", `${path}.policy.condition.value.threshold`) === undefined
        ? {}
        : { threshold: optionalJsonNumber(conditionValue, "threshold", `${path}.policy.condition.value.threshold`) }),
    });
  }));
}

function verdictFor(attempt: JsonObject, assertions: JsonObject | undefined): AttemptView["verdict"] {
  const outcome = requiredJsonString(attempt, "outcome", "Attempt");
  if (outcome === "errored" || outcome === "interrupted") return "errored";
  if (outcome === "cancelled") return "skipped";
  for (const [index, value] of (assertions === undefined ? [] : requiredArray(assertions, "entries-data")).entries()) {
    const path = `Assertions entries-data[${index}]`;
    const entry = requiredObject(value, path);
    const policy = requiredObject(entry.policy, `${path}.policy`);
    const requirement = requiredObject(policy.requirement, `${path}.policy.requirement`);
    const required = requirement?.state === "available" && requirement.value === "required";
    const decision = requiredObject(entry.decision, `${path}.decision`);
    if (required && (decision?.result === "unavailable" || decision?.result === "errored")) return "errored";
    if (decision?.gate === "failed") return "failed";
  }
  return "passed";
}

function scoreFor(assertions: readonly AssertionView[]): Pick<AttemptView, "scoreState" | "scoreEarned" | "scorePossible"> {
  const scored = assertions.filter((entry) => entry.points !== undefined);
  const unavailable = scored.some((entry) => entry.contributionState === "unavailable");
  return Object.freeze({
    scoreState: scored.length === 0 ? "not-scored" : unavailable ? "unavailable" : "complete",
    scoreEarned: scored.reduce((sum, entry) => sum + (entry.earned === undefined ? 0 : entry.earned), 0),
    scorePossible: scored.reduce((sum, entry) => sum + (entry.points === undefined ? 0 : entry.points), 0),
  });
}

function sourceViews(attachment: AttachmentRow | undefined): readonly SourceView[] {
  if (attachment === undefined) return Object.freeze([]);
  return Object.freeze(requiredArray(attachment.payload, "items-data").map((value, index) => {
    const path = `Sources items-data[${index}]`;
    const item = requiredObject(value, path);
    const handle = requiredContentHandle(item.content, `${path}.content`);
    const bytes = requiredMapValue(attachment.contents, handle, `${path}.content bytes`);
    return Object.freeze({
      id: requiredJsonString(item, "sourceItemId", path),
      path: requiredJsonString(item, "path", path),
      state: "available",
      sha256: requiredJsonString(item, "sha256", path),
      text: decoder.decode(bytes),
    });
  }));
}

function turnViews(payload: JsonObject | undefined): readonly TurnView[] {
  if (payload === undefined) return Object.freeze([]);
  const attachmentState = requiredJsonString(payload, "state", "Agent Turns");
  if (attachmentState !== "current" && attachmentState !== "legacy") {
    throw migrationRequired(`Current Agent Turns state ${JSON.stringify(attachmentState)} is invalid`);
  }
  const tools = new Map<string, TrajectoryItemView & { input?: string; output?: string }>();
  return Object.freeze(requiredArray(payload, "segments-data").map((value, turnIndex) => {
    const path = `Agent Turns segments-data[${turnIndex}]`;
    const segment = requiredObject(value, path);
    const items: TrajectoryItemView[] = [];
    for (const [itemIndex, rawItem] of requiredArray(segment, "items").entries()) {
      const itemPath = `${path}.items[${itemIndex}]`;
      const item = requiredObject(rawItem, itemPath);
      const kind = requiredJsonString(item, "kind", itemPath);
      const id = requiredJsonString(item, "itemId", itemPath);
      if (kind === "tool-start" || kind === "tool-call") {
        const occurrence = requiredJsonString(item, kind === "tool-start" ? "toolOccurrenceId" : "callId", itemPath);
        const input = requiredJsonString(item, "inputSummary", itemPath);
        const view = {
          id: occurrence,
          kind: "tool",
          state: "recorded",
          text: input,
          tool: requiredJsonString(item, "tool", itemPath),
          input,
        } satisfies TrajectoryItemView;
        if (tools.has(occurrence)) throw migrationRequired(`${itemPath} duplicates tool occurrence ${occurrence}`);
        tools.set(occurrence, view);
        items.push(view);
        continue;
      }
      if (kind === "tool-finish" || kind === "tool-result") {
        const occurrenceObject = kind === "tool-finish" ? requiredObject(item.occurrence, `${itemPath}.occurrence`) : undefined;
        const occurrence = kind === "tool-result"
          ? requiredJsonString(item, "callId", itemPath)
          : occurrenceObject?.state === "exact"
            ? requiredJsonString(occurrenceObject, "toolOccurrenceId", `${itemPath}.occurrence`)
            : undefined;
        const existing = occurrence === undefined ? undefined : tools.get(occurrence);
        const output = requiredJsonString(item, "outputSummary", itemPath);
        if (existing !== undefined) {
          if (existing.output !== undefined) throw migrationRequired(`${itemPath} duplicates tool result ${occurrence}`);
          Object.assign(existing, { output, text: `${existing.input === undefined ? "" : existing.input} ${output}`.trim() });
        } else {
          if (occurrenceObject?.state !== "unavailable") {
            throw migrationRequired(`${itemPath} has no matching tool start`);
          }
          const reason = requiredJsonString(occurrenceObject, "reason", `${itemPath}.occurrence`);
          items.push(Object.freeze({ id, kind: "tool-result", state: "unavailable", text: output, output, reason }));
        }
        continue;
      }
      let textValue: string;
      if (kind === "message") textValue = requiredJsonString(item, "text", itemPath);
      else if (kind === "thinking-summary" || kind === "compaction" || kind === "context-injection" ||
        kind === "subagent" || kind === "skill-load" || kind === "conversation-error") {
        textValue = requiredJsonString(item, "summary", itemPath);
      } else if (kind === "input-request") {
        const prompt = requiredJsonString(item, "promptSummary", itemPath);
        const response = nullableJsonString(item.responseSummary, `${itemPath}.responseSummary`);
        textValue = response === undefined ? prompt : `${prompt}\n${response}`;
      } else {
        throw migrationRequired(`${itemPath}.kind ${JSON.stringify(kind)} is not current`);
      }
      items.push(Object.freeze({
        id,
        kind,
        state: "recorded",
        ...(typeof item.role === "string" ? { role: item.role } : {}),
        text: textValue,
      }));
    }
    return Object.freeze({
      id: requiredJsonString(segment, "turnId", path),
      sequence: requiredJsonNumber(segment, "sequence", path),
      outcome: requiredEnum(segment.outcome, `${path}.outcome`, ["completed", "failed", "cancelled", "interrupted"] as const),
      items: Object.freeze(items),
    });
  }));
}

function coverageViews(payload: JsonObject | undefined): readonly CoverageView[] {
  if (payload === undefined) return Object.freeze([]);
  const output = new Map<string, CoverageView>();
  for (const [index, value] of requiredArray(payload, "segments-data").entries()) {
    const path = `Agent Turns segments-data[${index}].terminal`;
    const terminal = requiredObject(requiredObject(value, `Agent Turns segments-data[${index}]`).terminal, path);
    const terminalState = requiredEnum(terminal.state, `${path}.state`, ["recorded", "unavailable"] as const);
    if (terminalState === "unavailable") {
      const reason = requiredJsonString(terminal, "reason", path);
      for (const channel of ["events", "actions", "messages", "usage", "status", "data"] as const) {
        output.set(channel, Object.freeze({ channel, status: "unavailable", reason }));
      }
      continue;
    }
    const coverage = requiredObject(terminal.evidenceCoverage, `${path}.evidenceCoverage`);
    for (const channel of ["events", "actions", "messages", "usage", "status", "data"] as const) {
      const entry = requiredObject(coverage[channel], `${path}.evidenceCoverage.${channel}`);
      const status = requiredEnum(
        entry.status,
        `${path}.evidenceCoverage.${channel}.status`,
        ["complete", "partial", "unavailable"] as const,
      );
      output.set(channel, Object.freeze({
        channel,
        status,
        ...(typeof entry?.reason === "string" ? { reason: entry.reason } : {}),
      }));
    }
  }
  return Object.freeze([...output.values()]);
}

function usageViews(payload: JsonObject | undefined): readonly UsageView[] {
  if (payload === undefined) return Object.freeze([]);
  const output: UsageView[] = [];
  for (const [segmentIndex, rawSegment] of requiredArray(payload, "segments-data").entries()) {
    const segment = requiredObject(rawSegment, `Agent Turns segments-data[${segmentIndex}]`);
    for (const [index, value] of requiredArray(segment, "usage").entries()) {
      const path = `Agent Turns segments-data[${segmentIndex}].usage[${index}]`;
      const usage = requiredObject(value, path);
      const kind = requiredJsonString(usage, "kind", path);
      let label: string;
      let renderedValue: string;
      if (kind === "token-bucket") {
        label = `${requiredJsonString(usage, "provider", path)} · ${requiredJsonString(usage, "bucket", path)}`;
        renderedValue = String(requiredJsonNumber(usage, "tokens", path));
      } else if (kind === "request") {
        label = `${requiredJsonString(usage, "provider", path)} · ${requiredJsonString(usage, "requestKind", path)}`;
        renderedValue = "1";
      } else if (kind === "provider-cost") {
        label = `${requiredJsonString(usage, "provider", path)} · ${requiredJsonString(usage, "currency", path)}`;
        renderedValue = requiredJsonString(usage, "amount", path);
      } else {
        throw migrationRequired(`${path}.kind ${JSON.stringify(kind)} is not current`);
      }
      output.push(Object.freeze({
        id: requiredJsonString(usage, "usageObservationId", path),
        kind,
        label,
        value: renderedValue,
      }));
    }
  }
  return Object.freeze(output);
}

function activityViews(payload: JsonObject | undefined): readonly ActivityView[] {
  if (payload === undefined) return Object.freeze([]);
  return Object.freeze(requiredArray(payload, "segments-data").map((value, index) => {
    const path = `Runner Activities segments-data[${index}]`;
    const activity = requiredObject(value, path);
    return Object.freeze({
      id: requiredJsonString(activity, "activityId", path),
      phase: requiredJsonString(activity, "phase", path),
      label: requiredJsonString(activity, "label", path),
      startOffsetMs: requiredJsonNumber(activity, "startOffsetMs", path),
      durationMs: requiredJsonNumber(activity, "durationMs", path),
      outcome: requiredEnum(
        activity.outcome,
        `${path}.outcome`,
        ["completed", "failed", "cancelled", "interrupted", "unknown"] as const,
      ),
    });
  }));
}

function commandViews(attachment: AttachmentRow | undefined): readonly CommandView[] {
  if (attachment === undefined) return Object.freeze([]);
  const state = recordedCollectionStatus(attachment.payload).state;
  return Object.freeze(requiredArray(attachment.payload, "segments-data").map((value, index) => {
    const path = `Sandbox Commands segments-data[${index}]`;
    const command = requiredObject(value, path);
    const invocation = requiredObject(command.invocation, `${path}.invocation`);
    const outcome = requiredObject(command.outcome, `${path}.outcome`);
    let invocationText: string;
    if (invocation.kind === "argv") {
      invocationText = [
        requiredJsonString(invocation, "executable", `${path}.invocation`),
        ...requiredArray(invocation, "arguments").map((argument, argumentIndex) =>
          requiredString(argument, `${path}.invocation.arguments[${argumentIndex}]`)),
      ].join(" ");
    } else if (invocation.kind === "shell") {
      invocationText = requiredJsonString(invocation, "command", `${path}.invocation`);
    } else {
      throw migrationRequired(`${path}.invocation.kind is invalid`);
    }
    const stdout = commandStream(attachment, command.stdout, `${path}.stdout`);
    const stderr = commandStream(attachment, command.stderr, `${path}.stderr`);
    return Object.freeze({
      id: requiredJsonString(command, "commandId", path),
      phase: requiredJsonString(command, "phase", path),
      invocation: invocationText,
      outcome: requiredJsonString(outcome, "kind", `${path}.outcome`),
      stdout: stdout.text,
      stderr: stderr.text,
      state,
      stdoutState: stdout.state,
      stderrState: stderr.state,
      stdoutRetainedBytes: stdout.retainedBytes,
      stdoutTotalBytes: stdout.totalBytes,
      stderrRetainedBytes: stderr.retainedBytes,
      stderrTotalBytes: stderr.totalBytes,
    });
  }));
}

function diagnosticViews(payload: JsonObject | undefined): readonly DiagnosticView[] {
  if (payload === undefined) return Object.freeze([]);
  return Object.freeze(requiredArray(payload, "segments-data").map((value, index) => {
    const path = `Runner Diagnostics segments-data[${index}]`;
    const diagnostic = requiredObject(value, path);
    const redaction = requiredObject(diagnostic.redaction, `${path}.redaction`);
    const redactionState = requiredEnum(redaction.state, `${path}.redaction.state`, ["none", "applied"] as const);
    return Object.freeze({
      id: requiredJsonString(diagnostic, "diagnosticId", path),
      kind: requiredJsonString(diagnostic, "kind", path),
      code: requiredJsonString(diagnostic, "code", path),
      summary: requiredJsonString(diagnostic, "summary", path),
      redaction: redactionState === "none"
        ? Object.freeze({ state: "none" as const })
        : Object.freeze({
          state: "applied" as const,
          replacements: requiredJsonSafeInteger(redaction, "replacements", `${path}.redaction`),
        }),
    });
  }));
}

function fileChangeViews(attachment: AttachmentRow | undefined): readonly FileChangeView[] {
  if (attachment === undefined) return Object.freeze([]);
  return Object.freeze(requiredArray(attachment.payload, "windows-data").flatMap((rawWindow, windowIndex) => {
    const windowPath = `File Changes windows-data[${windowIndex}]`;
    const window = requiredObject(rawWindow, windowPath);
    return requiredArray(window, "changes").map((rawChange, changeIndex) => {
      const path = `${windowPath}.changes[${changeIndex}]`;
      const change = requiredObject(rawChange, path);
      const kind = requiredJsonString(change, "kind", path);
      if (kind !== "created" && kind !== "modified" && kind !== "deleted") {
        throw migrationRequired(`${path}.kind ${JSON.stringify(kind)} is invalid`);
      }
      const before = fileEndpoint(attachment, change.before, `${path}.before`);
      const after = fileEndpoint(attachment, change.after, `${path}.after`);
      return Object.freeze({
        id: requiredJsonString(change, "changeId", path),
        path: requiredJsonString(change, "path", path),
        kind,
        state: after.state === "absent" ? before.state : after.state,
        before,
        after,
        ...(before.state === "available" ? { beforeText: before.text } : {}),
        ...(after.state === "available" ? { afterText: after.text } : {}),
      });
    });
  }));
}

function artifactViews(payload: JsonObject | undefined): readonly ArtifactView[] {
  if (payload === undefined) return Object.freeze([]);
  return Object.freeze(requiredArray(payload, "artifacts-data").map((value, index) => {
    const path = `Artifacts artifacts-data[${index}]`;
    const artifact = requiredObject(value, path);
    return Object.freeze({
      id: requiredJsonString(artifact, "artifactId", path),
      label: requiredJsonString(artifact, "label", path),
      mediaType: requiredJsonString(artifact, "mediaType", path),
      byteLength: requiredJsonNumber(artifact, "byteLength", path),
      state: "recorded",
    });
  }));
}

function experimentViews(runs: readonly InternalRun[], attempts: ReadonlyMap<string, AttemptView>): readonly InternalExperiment[] {
  const grouped = new Map<string, InternalRun[]>();
  for (const run of runs) {
    const list = grouped.get(run.experimentId) ?? [];
    list.push(run);
    grouped.set(run.experimentId, list);
  }
  return Object.freeze([...grouped].sort(([left], [right]) => left.localeCompare(right)).map(([experimentId, experimentRuns]) => {
    const members = experimentRuns.flatMap((run) => run.members);
    const attemptViews = members.flatMap((member) => member.attemptKey === undefined ? [] : [attempts.get(member.attemptKey)]).filter(isDefined);
    return Object.freeze({
      experimentId,
      runs: Object.freeze(experimentRuns),
      evalIds: Object.freeze([...new Set(members.map((member) => member.evalId))].sort()),
      attempts: attemptViews.length,
      passed: attemptViews.filter((attempt) => attempt.verdict === "passed").length,
    });
  }));
}

function attachmentIssues(attachments: readonly AttachmentRow[]): readonly string[] {
  const collectionFamilies = new Set([
    "niceeval.agent-turns",
    "niceeval.runner-activities",
    "niceeval.sandbox-commands",
    "niceeval.runner-diagnostics",
    "niceeval.file-changes",
    "niceeval.artifacts",
  ]);
  return Object.freeze(attachments.flatMap((attachment) => {
    if (!collectionFamilies.has(attachment.family)) return [];
    const status = collectionStatus(attachment);
    return status.state === "complete" ? [] : [
      `${attachment.family}: ${status.state}`,
      ...status.limitations.map((limitation) => `${attachment.family}: ${limitation.summary}`),
    ];
  }));
}

function collectionState(payload: JsonObject | undefined): AttemptView["artifactsState"] {
  return collectionPayloadStatus(payload).state;
}

function presenceStatus(attachment: AttachmentRow | undefined): FamilyStatusResult {
  return Object.freeze({
    state: attachment === undefined ? "not-recorded" : "recorded",
    limitations: Object.freeze([]),
  });
}

function collectionStatus(attachment: Pick<AttachmentRow, "payload"> | undefined): FamilyStatusResult & { readonly state: CollectionState } {
  return collectionPayloadStatus(attachment?.payload);
}

function collectionPayloadStatus(payload: JsonObject | undefined): FamilyStatusResult & { readonly state: CollectionState } {
  if (payload === undefined) {
    return Object.freeze({ state: "not-recorded", limitations: Object.freeze([]) });
  }
  return recordedCollectionStatus(payload);
}

function recordedCollectionStatus(
  payload: JsonObject,
): FamilyStatusResult & { readonly state: "complete" | "partial" } {
  const collection = requiredObject(payload["collection-data"], "collection-data");
  const state = requiredEnum(collection.state, "collection-data.state", ["complete", "partial"] as const);
  const limitations = Object.freeze(requiredArray(collection, "limitations").map((value, index) => {
    const limitation = requiredObject(value, `collection-data.limitations[${index}]`);
    const code = requiredJsonString(limitation, "code", `collection-data.limitations[${index}]`);
    const summary = JSON.stringify(limitation);
    if (summary === undefined) throw migrationRequired(`collection-data.limitations[${index}] is not JSON`);
    return Object.freeze({ code, summary });
  }));
  if (state === "complete" && limitations.length !== 0 || state === "partial" && limitations.length === 0) {
    throw migrationRequired(`collection-data.${state} has inconsistent limitations`);
  }
  return Object.freeze({ state, limitations });
}

function contentText(attachment: AttachmentRow, value: unknown, path: string): string {
  const handle = requiredContentHandle(value, path);
  return decoder.decode(requiredMapValue(attachment.contents, handle, `${path} bytes`));
}

function commandStream(
  attachment: AttachmentRow,
  value: unknown,
  path: string,
): {
  readonly text: string;
  readonly state: "complete" | "truncated";
  readonly retainedBytes: number;
  readonly totalBytes: number;
} {
  const stream = requiredObject(value, path);
  const retainedBytes = requiredJsonSafeInteger(stream, "retainedBytes", path);
  const totalBytes = requiredJsonSafeInteger(stream, "totalSafeUtf8Bytes", path);
  if (retainedBytes < 0 || totalBytes < retainedBytes) {
    throw migrationRequired(`${path} byte boundaries are invalid`);
  }
  return Object.freeze({
    text: contentText(attachment, stream.content, `${path}.content`),
    state: retainedBytes === totalBytes ? "complete" : "truncated",
    retainedBytes,
    totalBytes,
  });
}

function requiredContentHandle(value: unknown, path: string): string {
  const marker = requiredObject(value, path)["$niceeval.record.content"];
  if (typeof marker !== "string" || marker.length === 0) {
    throw migrationRequired(`${path} is not a current Record content handle`);
  }
  return marker;
}

function fileEndpoint(
  attachment: AttachmentRow,
  value: unknown,
  path: string,
): FileEndpointResult {
  const endpoint = requiredObject(value, path);
  const state = requiredJsonString(endpoint, "state", path);
  if (state === "absent") return Object.freeze({ state });
  if (state !== "present") throw migrationRequired(`${path}.state ${JSON.stringify(state)} is invalid`);
  const revision = requiredObject(endpoint.revision, `${path}.revision`);
  const kind = requiredJsonString(revision, "kind", `${path}.revision`);
  if (kind === "text") {
    const content = requiredObject(revision.content, `${path}.revision.content`);
    const contentState = requiredJsonString(content, "state", `${path}.revision.content`);
    if (contentState === "available") {
      return Object.freeze({
        state: "available",
        text: contentText(attachment, content.content, `${path}.revision.content.content`),
      });
    }
    if (contentState === "omitted") return Object.freeze({
      state: "omitted",
      reason: requiredJsonString(content, "reason", `${path}.revision.content`),
    });
    throw migrationRequired(`${path}.revision.content.state ${JSON.stringify(contentState)} is invalid`);
  }
  if (kind === "elided" || kind === "unavailable") {
    return Object.freeze({ state: kind, reason: requiredJsonString(revision, "reason", `${path}.revision`) });
  }
  throw migrationRequired(`${path}.revision.kind ${JSON.stringify(kind)} is invalid`);
}

function factText(value: JsonObject | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (value.kind === "unavailable") return requiredJsonString(value, "reason", "Assertion fact");
  if (value.kind === "value") {
    const rendered = JSON.stringify(value.value);
    if (rendered === undefined) throw migrationRequired("Assertion fact value is not JSON");
    return typeof value.value === "string" ? value.value : rendered;
  }
  if (value.kind === "text") return requiredJsonString(value, "text", "Assertion fact");
  if (value.kind === "list") {
    return requiredArray(value, "items").map((item, index) =>
      factText(requiredObject(item, `Assertion fact items[${index}]`))).join(", ");
  }
  if (value.kind === "fields") {
    return requiredArray(value, "fields").map((item, index) => {
      const field = requiredObject(item, `Assertion fact fields[${index}]`);
      return `${requiredJsonString(field, "label", `Assertion fact fields[${index}]`)}: ${factText(requiredObject(field.value, `Assertion fact fields[${index}].value`))}`;
    }).join(", ");
  }
  throw migrationRequired(`Assertion fact kind ${JSON.stringify(value.kind)} is invalid`);
}

function object(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonObject : undefined;
}

function requiredObject(value: unknown, path: string): JsonObject {
  const result = object(value);
  if (result === undefined) throw migrationRequired(`${path} is not an object`);
  return result;
}

function requiredArray(value: JsonObject, key: string): readonly unknown[] {
  const result = value[key];
  if (!Array.isArray(result)) throw migrationRequired(`${key} is not an array`);
  return result;
}

function requiredString(value: unknown, path: string): string {
  if (typeof value !== "string") throw migrationRequired(`${path} is not a string`);
  return value;
}

function requiredEnum<const Values extends readonly string[]>(
  value: unknown,
  path: string,
  values: Values,
): Values[number] {
  if (typeof value !== "string" || !values.includes(value)) {
    throw migrationRequired(`${path} is not one of ${values.join(", ")}`);
  }
  return value as Values[number];
}

function requiredJsonString(value: JsonObject, key: string, path = "Current Record"): string {
  const field = value[key];
  if (typeof field !== "string") throw migrationRequired(`${path}.${key} is not a string`);
  return field;
}

function optionalJsonString(value: JsonObject, key: string, path: string): string | undefined {
  const field = value[key];
  if (field === undefined) return undefined;
  if (typeof field !== "string") throw migrationRequired(`${path} is not a string`);
  return field;
}

function nullableJsonString(value: unknown, path: string): string | undefined {
  if (value === null) return undefined;
  return requiredString(value, path);
}

function requiredJsonNumber(value: JsonObject, key: string, path: string): number {
  const field = value[key];
  if (typeof field !== "number" || !Number.isFinite(field)) throw migrationRequired(`${path}.${key} is not a finite number`);
  return field;
}

function requiredJsonSafeInteger(value: JsonObject, key: string, path: string): number {
  const field = value[key];
  if (typeof field !== "number" || !Number.isSafeInteger(field)) {
    throw migrationRequired(`${path}.${key} is not a safe integer`);
  }
  return field;
}

function optionalJsonNumber(value: JsonObject, key: string, path: string): number | undefined {
  const field = value[key];
  if (field === undefined) return undefined;
  if (typeof field !== "number" || !Number.isFinite(field)) throw migrationRequired(`${path} is not a finite number`);
  return field;
}

function jsonObject(value: SqlValue | undefined, field: string): JsonObject {
  try {
    return requiredObject(JSON.parse(sqlText(value, field)), field);
  } catch {
    throw migrationRequired(`${field} is not a current JSON object`);
  }
}

function sqlText(value: SqlValue | undefined, field: string): string {
  if (typeof value === "string") return value;
  if (value instanceof Uint8Array || value instanceof Int8Array) return decoder.decode(value);
  if (value instanceof ArrayBuffer) return decoder.decode(value);
  throw migrationRequired(`${field} is not text`);
}

function integer(value: SqlValue | undefined, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) throw migrationRequired(`${field} is not an integer`);
  return value;
}

function nullableText(value: SqlValue | undefined): string | undefined {
  return value === null || value === undefined ? undefined : sqlText(value, "nullable text field");
}

function blob(value: SqlValue | undefined): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof Int8Array) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  throw migrationRequired("contents.bytes is not a blob");
}

function requiredMapValue<Key, Value>(map: ReadonlyMap<Key, Value>, key: Key, path: string): Value {
  const value = map.get(key);
  if (value === undefined) throw migrationRequired(`${path} is missing`);
  return value;
}

function requiredRun(runs: readonly InternalRun[], runId: string): InternalRun {
  const run = runs.find((candidate) => candidate.runId === runId);
  if (run === undefined) throw migrationRequired(`Attempt origin Run ${JSON.stringify(runId)} is missing`);
  return run;
}

function currentCostAmount(value: string): number {
  if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]*[1-9])?$/u.test(value)) {
    throw migrationRequired(`Provider cost amount ${JSON.stringify(value)} is invalid`);
  }
  const amount = Number(value);
  if (!Number.isFinite(amount)) throw migrationRequired(`Provider cost amount ${JSON.stringify(value)} is not finite`);
  return amount;
}

function utcMillisText(value: JsonObject, key: string, path: string): string {
  const millis = requiredJsonSafeInteger(value, key, path);
  const date = new Date(millis);
  if (!Number.isFinite(date.getTime())) throw migrationRequired(`${path}.${key} is outside the UTC timestamp range`);
  return date.toISOString();
}

function attemptKey(originRunId: string, attemptId: string): string {
  return `${originRunId}\u0000${attemptId}`;
}

function isDefined<Value>(value: Value | undefined): value is Value {
  return value !== undefined;
}
