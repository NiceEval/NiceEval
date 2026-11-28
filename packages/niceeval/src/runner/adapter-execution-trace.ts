import { createHash, randomBytes } from "node:crypto";
import { openSync, readSync, closeSync } from "node:fs";
import { setImmediate } from "node:timers/promises";

import { Data, Result, Schema, SchemaIssue } from "effect";

import type { AdapterCreateContext } from "../adapter.ts";
import type {
  ExecutionTraceInput,
  ExecutionTraceReceipt,
  ExecutionTraceStreamInput,
  ExecutionTraceStreamItem,
  ExecutionTraceStreamReceipt,
  TraceJson,
} from "../adapter-execution-trace.ts";
import {
  canonicalTraceJsonChunks,
  displayTextHasForbiddenCharacter,
  parseTraceArtifactJson,
  snapshotTraceJson,
  ExecutionDisplayImageMediaTypes,
  ExecutionTraceInputSchema,
  ExecutionTraceInputHeaderSchema,
  ExecutionTraceStreamItemSchema,
  type ExecutionDisplayBlockRecord,
  type ExecutionTraceEventRecord,
  type ExecutionTraceHeaderRecord,
  type ExecutionTraceRecord,
  type ExecutionTraceStoredRecord,
} from "../record/family/execution-traces/schema.ts";
import type { DiagnosticInput } from "../shared/types.ts";
import { sqliteError, type SqliteRecordError } from "../record/sqlite/errors.ts";
import type { EvalResult } from "./types.ts";
import type { CapturedAdapterAttachment } from "./adapter-attachments.ts";
import { AdapterTracePull } from "./adapter-trace-pull.ts";
import {
  AdapterTraceStaging,
  InvalidStagedTrace,
  type StagedTraceItem,
  type TraceEvidenceCache,
  type VerifiedEvidenceTarget,
} from "./adapter-trace-staging.ts";

export class AdapterExecutionTraceError extends Data.TaggedError("AdapterExecutionTraceError")<{
  readonly code:
    | "execution-trace-invalid"
    | "execution-trace-conflict"
    | "execution-trace-evidence-missing"
    | "execution-trace-closed"
    | "execution-trace-failed"
    | "execution-display-invalid";
  readonly message: string;
}> {}

export interface AcceptedExecutionTrace {
  readonly mode: "array";
  readonly sourceTraceId: string;
  readonly canonicalInputDigest: string;
  readonly receipt: ExecutionTraceReceipt;
  readonly records: readonly ExecutionTraceRecord[];
  readonly summary: ExecutionTraceStreamReceipt;
}

interface AcceptedStreamTrace {
  readonly mode: "stream";
  readonly canonicalInputDigest: string;
  readonly summary: ExecutionTraceStreamReceipt;
  readonly records: Iterable<ExecutionTraceStoredRecord>;
  readonly staging: AdapterTraceStaging;
  arrayReceipt?: ExecutionTraceReceipt;
}

export interface AdapterExecutionTraceSnapshot {
  readonly traces: readonly (AcceptedExecutionTrace | AcceptedStreamTrace)[];
  readonly failure: AdapterExecutionTraceError | undefined;
  readonly storageFailure: SqliteRecordError | undefined;
}

const captures = new WeakMap<EvalResult, AdapterExecutionTraceSnapshot>();

export function retainAdapterExecutionTraces(result: EvalResult, snapshot: AdapterExecutionTraceSnapshot): void {
  if (snapshot.traces.length > 0 || snapshot.failure !== undefined || snapshot.storageFailure !== undefined) {
    captures.set(result, snapshot);
  }
}

export function adapterExecutionTracesForResult(result: EvalResult): AdapterExecutionTraceSnapshot | undefined {
  return captures.get(result);
}

export interface AdapterExecutionTraceCollector {
  readonly recordTrace: AdapterCreateContext["recordTrace"];
  readonly failure: () => AdapterExecutionTraceError | undefined;
  readonly close: () => Promise<void>;
  readonly dispose: () => void;
  readonly snapshot: () => AdapterExecutionTraceSnapshot;
}

const exactDecode = Schema.decodeUnknownResult(ExecutionTraceInputSchema, {
  onExcessProperty: "error",
});
const formatSchemaIssues = SchemaIssue.makeFormatterStandardSchemaV1();

function invalidEnvelope(error: Schema.SchemaError): AdapterExecutionTraceError {
  const displayIssue = formatSchemaIssues(error.issue).issues.find(
    (issue) => issue.path?.[0] === "events" && issue.path?.[2] === "display",
  );
  if (displayIssue !== undefined) {
    const path = (displayIssue.path ?? [])
      .map((part) => (typeof part === "number" ? `[${part}]` : `.${String(part)}`))
      .join("")
      .replace(/^\./u, "");
    return traceError("execution-display-invalid", `${path}: invalid display block shape.`);
  }
  return traceError("execution-trace-invalid", "Execution trace envelope is invalid.");
}

function traceError(code: AdapterExecutionTraceError["code"], message: string): AdapterExecutionTraceError {
  return new AdapterExecutionTraceError({ code, message });
}

function digestCanonicalTraceJson(value: TraceJson): { readonly sha256: string; readonly byteLength: number } {
  const hash = createHash("sha256");
  let byteLength = 0;
  for (const chunk of canonicalTraceJsonChunks(value)) {
    byteLength += Buffer.byteLength(chunk);
    hash.update(chunk);
  }
  return { sha256: hash.digest("hex"), byteLength };
}

function stableId(prefix: "et" | "ee" | "ev"): string {
  return `${prefix}_${randomBytes(10).toString("hex")}`;
}

function rejectSettled<T>(error: AdapterExecutionTraceError): Promise<T> {
  const rejected = Promise.reject<T>(error);
  void rejected.catch(() => undefined);
  return rejected;
}

function jsonPointerSegments(pointer: string): readonly string[] | undefined {
  if (pointer === "") return [];
  if (!pointer.startsWith("/")) return undefined;
  const output: string[] = [];
  for (const token of pointer.slice(1).split("/")) {
    let decoded = "";
    for (let index = 0; index < token.length; index += 1) {
      const character = token[index]!;
      if (character !== "~") {
        decoded += character;
        continue;
      }
      const escape = token[index + 1];
      if (escape === "0") decoded += "~";
      else if (escape === "1") decoded += "/";
      else return undefined;
      index += 1;
    }
    output.push(decoded);
  }
  return output;
}

function resolvePointer(root: unknown, pointer: string): unknown | undefined {
  const segments = jsonPointerSegments(pointer);
  if (segments === undefined) return undefined;
  let current = root;
  for (const segment of segments) {
    if (Array.isArray(current)) {
      if (!/^(?:0|[1-9][0-9]*)$/u.test(segment)) return undefined;
      const index = Number(segment);
      if (
        !Number.isSafeInteger(index) ||
        index >= current.length ||
        !Object.prototype.hasOwnProperty.call(current, segment)
      )
        return undefined;
      current = current[index];
      continue;
    }
    if (typeof current !== "object" || current === null || !Object.prototype.hasOwnProperty.call(current, segment))
      return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(current, segment);
    if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true) return undefined;
    current = descriptor.value;
  }
  return current;
}

function causesCycle(keys: readonly string[], edges: ReadonlyMap<string, readonly string[]>): boolean {
  const state = new Map<string, "visiting" | "visited">();
  for (const root of keys) {
    if (state.get(root) === "visited") continue;
    const stack: Array<{ readonly key: string; next: number }> = [{ key: root, next: 0 }];
    state.set(root, "visiting");
    while (stack.length > 0) {
      const frame = stack[stack.length - 1]!;
      const targets = edges.get(frame.key) ?? [];
      const target = targets[frame.next];
      if (target === undefined) {
        state.set(frame.key, "visited");
        stack.pop();
        continue;
      }
      frame.next += 1;
      const targetState = state.get(target);
      if (targetState === "visiting") return true;
      if (targetState === "visited") continue;
      state.set(target, "visiting");
      stack.push({ key: target, next: 0 });
    }
  }
  return false;
}

function parseArtifactJson(artifact: CapturedAdapterAttachment): unknown {
  if (artifact.mediaType !== "application/json") {
    throw traceError(
      "execution-trace-evidence-missing",
      `Evidence artifact ${artifact.artifactId} is not application/json.`,
    );
  }
  const hash = createHash("sha256");
  let byteLength = 0;
  function* chunks(): Generator<Uint8Array> {
    const chunkBytes = 64 * 1024;
    if (artifact.filePath === undefined) {
      for (let offset = 0; offset < artifact.bytes.byteLength; offset += chunkBytes) {
        const chunk = artifact.bytes.subarray(offset, offset + chunkBytes);
        hash.update(chunk);
        byteLength += chunk.byteLength;
        yield chunk;
      }
      return;
    }
    const fd = openSync(artifact.filePath, "r");
    try {
      const buffer = new Uint8Array(chunkBytes);
      for (;;) {
        const count = readSync(fd, buffer, 0, buffer.byteLength, null);
        if (count === 0) break;
        const chunk = buffer.subarray(0, count);
        hash.update(chunk);
        byteLength += chunk.byteLength;
        yield chunk;
      }
    } finally {
      closeSync(fd);
    }
  }
  let parsed: unknown;
  try {
    parsed = parseTraceArtifactJson(chunks());
  } catch {
    throw traceError(
      "execution-trace-evidence-missing",
      `Evidence artifact ${artifact.artifactId} could not be read as UTF-8 JSON.`,
    );
  }
  if (byteLength !== artifact.byteLength || hash.digest("hex") !== artifact.sha256) {
    throw traceError(
      "execution-trace-evidence-missing",
      `Evidence artifact ${artifact.artifactId} integrity check failed.`,
    );
  }
  return parsed;
}

type InputEvent = Schema.Schema.Type<typeof ExecutionTraceInputSchema>["events"][number];
type InputDisplayBlock = NonNullable<InputEvent["display"]>[number];

function displayInvalid(
  eventIndex: number,
  blockIndex: number | undefined,
  field: string,
  reason: string,
): AdapterExecutionTraceError {
  const path =
    blockIndex === undefined ? `events[${eventIndex}].display` : `events[${eventIndex}].display[${blockIndex}]`;
  return traceError("execution-display-invalid", `${path}.${field}: ${reason}`);
}

function checkDisplayString(
  value: string,
  eventIndex: number,
  blockIndex: number,
  field: string,
  singleLine = false,
): void {
  if (displayTextHasForbiddenCharacter(value)) {
    throw displayInvalid(eventIndex, blockIndex, field, "contains a control or bidirectional formatting character.");
  }
  if (singleLine && value.includes("\n")) {
    throw displayInvalid(eventIndex, blockIndex, field, "must not contain a line break.");
  }
}

/** Validates one event's display blocks against the closed vocabulary. */
function verifyDisplay(event: InputEvent, eventIndex: number): void {
  const display = event.display;
  if (display === undefined) return;
  if (display.length === 0)
    throw displayInvalid(eventIndex, undefined, "length", "must not be empty; omit display instead.");
  for (const [blockIndex, block] of display.entries()) {
    switch (block.kind) {
      case "text":
        checkDisplayString(block.text, eventIndex, blockIndex, "text");
        break;
      case "message":
        checkDisplayString(block.text, eventIndex, blockIndex, "text");
        if (block.speaker !== undefined) {
          checkDisplayString(block.speaker, eventIndex, blockIndex, "speaker", true);
        }
        break;
      case "fields":
        for (const [fieldIndex, field] of block.fields.entries()) {
          checkDisplayString(field.label, eventIndex, blockIndex, `fields[${fieldIndex}].label`, true);
          if (typeof field.value === "string")
            checkDisplayString(field.value, eventIndex, blockIndex, `fields[${fieldIndex}].value`);
        }
        break;
      case "code":
        checkDisplayString(block.text, eventIndex, blockIndex, "text");
        if (block.language !== undefined) {
          checkDisplayString(block.language, eventIndex, blockIndex, "language", true);
        }
        break;
      case "image":
        checkDisplayString(block.alt, eventIndex, blockIndex, "alt", true);
        break;
    }
  }
}

/** Fixes each image block to the accepted attachment descriptor. */
function durableDisplay(
  display: readonly InputDisplayBlock[] | undefined,
  eventIndex: number,
  byArtifactId: ReadonlyMap<string, CapturedAdapterAttachment>,
): readonly [ExecutionDisplayBlockRecord, ...ExecutionDisplayBlockRecord[]] | undefined {
  if (display === undefined) return undefined;
  const blocks = display.map((block, blockIndex): ExecutionDisplayBlockRecord => {
    if (block.kind !== "image") return block as ExecutionDisplayBlockRecord;
    const artifact = byArtifactId.get(block.artifactId);
    if (artifact === undefined) {
      throw displayInvalid(
        eventIndex,
        blockIndex,
        "artifactId",
        `${block.artifactId} is not attached to this Attempt.`,
      );
    }
    if (!ExecutionDisplayImageMediaTypes.has(artifact.mediaType)) {
      throw displayInvalid(
        eventIndex,
        blockIndex,
        "artifactId",
        `${block.artifactId} is ${artifact.mediaType}, not a supported image type.`,
      );
    }
    return {
      kind: "image",
      artifactId: block.artifactId,
      alt: block.alt,
      mediaType: artifact.mediaType as Extract<ExecutionDisplayBlockRecord, { kind: "image" }>["mediaType"],
      byteLength: artifact.byteLength,
      sha256: artifact.sha256,
    };
  });
  return blocks.length === 0 ? undefined : (blocks as [ExecutionDisplayBlockRecord, ...ExecutionDisplayBlockRecord[]]);
}

function durableEvent(
  traceId: string,
  eventId: string,
  ordinal: number,
  event: InputEvent,
  byArtifactId: ReadonlyMap<string, CapturedAdapterAttachment>,
  parsedArtifacts: Map<string, unknown>,
  verifiedTargets: TraceEvidenceCache,
  mintEvidenceId: () => string,
): ExecutionTraceEventRecord {
  const durableEvidence: ExecutionTraceEventRecord["evidence"][number][] = [];
  for (const evidence of event.evidence ?? []) {
    const artifact = byArtifactId.get(evidence.artifactId);
    if (artifact === undefined) {
      throw traceError(
        "execution-trace-evidence-missing",
        `Evidence artifact ${evidence.artifactId} is not attached to this Attempt.`,
      );
    }
    const targetKey = JSON.stringify([artifact.artifactId, artifact.sha256, evidence.pointer]);
    let verified = verifiedTargets.get(targetKey);
    if (verified === undefined) {
      const artifactCacheKey = `${artifact.artifactId}\u0000${artifact.sha256}`;
      let artifactJson = parsedArtifacts.get(artifactCacheKey);
      if (artifactJson === undefined) {
        artifactJson = parseArtifactJson(artifact);
        parsedArtifacts.set(artifactCacheKey, artifactJson);
      }
      const target = resolvePointer(artifactJson, evidence.pointer);
      if (target === undefined) {
        throw traceError(
          "execution-trace-evidence-missing",
          `Evidence pointer ${evidence.pointer} does not resolve in ${artifact.artifactId}.`,
        );
      }
      const canonicalTarget = snapshotTraceJson(target);
      if (Result.isFailure(canonicalTarget)) {
        throw traceError("execution-trace-evidence-missing", "Execution trace evidence target is invalid.");
      }
      const targetIdentity = digestCanonicalTraceJson(canonicalTarget.success);
      verified = {
        artifactSha256: artifact.sha256,
        targetSha256: targetIdentity.sha256,
        targetByteLength: targetIdentity.byteLength,
      };
      verifiedTargets.set(targetKey, verified);
    }
    const evidenceId = mintEvidenceId();
    durableEvidence.push({
      key: evidence.key,
      label: evidence.label,
      artifactId: evidence.artifactId,
      pointer: evidence.pointer,
      evidenceId,
      ...verified,
    });
  }
  return {
    kind: "event",
    traceId,
    eventId,
    ordinal,
    key: event.key,
    type: event.type,
    source: event.source,
    ...(event.actor === undefined ? {} : { actor: event.actor }),
    ...(event.time === undefined ? {} : { time: event.time }),
    summary: event.summary,
    ...(event.payload === undefined ? {} : { payload: event.payload as TraceJson }),
    links: (event.links ?? []).map((link) =>
      "targetKey" in link
        ? { relation: link.relation, targetKey: link.targetKey }
        : { relation: link.relation, unresolved: link.unresolved },
    ),
    evidence: durableEvidence,
    scopeMemberships: event.scopeMemberships ?? [],
    ...(() => {
      const display = durableDisplay(event.display, ordinal, byArtifactId);
      return display === undefined ? {} : { display };
    })(),
  };
}

function verifySemantics(input: Schema.Schema.Type<typeof ExecutionTraceInputSchema>): void {
  collectionDeclaration(input.collection);
  const scopeIds = new Set<string>();
  for (const scope of input.scopes) {
    if (scopeIds.has(scope.scopeId))
      throw traceError("execution-trace-invalid", "Execution trace scopeId values must be unique.");
    scopeIds.add(scope.scopeId);
  }
  const eventKeys = new Set<string>();
  const causeEdges = new Map<string, string[]>();
  const clockUnits = new Map<string, string>();
  for (const [eventIndex, event] of input.events.entries()) {
    verifyDisplay(event, eventIndex);
    if (eventKeys.has(event.key))
      throw traceError("execution-trace-invalid", "Execution trace event keys must be unique.");
    eventKeys.add(event.key);
    const evidenceKeys = new Set<string>();
    for (const evidence of event.evidence ?? []) {
      if (evidenceKeys.has(evidence.key))
        throw traceError("execution-trace-invalid", "Execution trace evidence keys must be unique within an event.");
      evidenceKeys.add(evidence.key);
      if (jsonPointerSegments(evidence.pointer) === undefined)
        throw traceError("execution-trace-invalid", "Execution trace evidence pointer is not RFC 6901 syntax.");
    }
    const memberships = new Set<string>();
    for (const membership of event.scopeMemberships ?? []) {
      if (!scopeIds.has(membership.scopeId) || memberships.has(membership.scopeId)) {
        throw traceError(
          "execution-trace-invalid",
          "Execution trace memberships must uniquely reference declared scopes.",
        );
      }
      memberships.add(membership.scopeId);
    }
    if (event.time !== undefined) {
      const unit = clockUnits.get(event.time.clockId);
      if (unit !== undefined && unit !== event.time.unit) {
        throw traceError("execution-trace-invalid", "A trace clockId must use one unit.");
      }
      clockUnits.set(event.time.clockId, event.time.unit);
    }
  }
  for (const event of input.events) {
    for (const link of event.links ?? []) {
      if (!("targetKey" in link)) continue;
      if (!eventKeys.has(link.targetKey))
        throw traceError("execution-trace-invalid", "Resolved execution trace links must target the same snapshot.");
      if (link.relation === "causes") {
        const edges = causeEdges.get(event.key) ?? [];
        edges.push(link.targetKey);
        causeEdges.set(event.key, edges);
      }
    }
  }
  if (causesCycle([...eventKeys], causeEdges)) {
    throw traceError("execution-trace-invalid", "Execution trace causes links must be acyclic.");
  }
}

type TraceInputHeader = Schema.Schema.Type<typeof ExecutionTraceInputHeaderSchema>;

const decodeStreamHeader = Schema.decodeUnknownResult(ExecutionTraceInputHeaderSchema, { onExcessProperty: "error" });
const decodeStreamItem = Schema.decodeUnknownResult(ExecutionTraceStreamItemSchema, { onExcessProperty: "error" });

function canonicalItem(value: unknown): string {
  return [...canonicalTraceJsonChunks(value as TraceJson)].join("");
}

function traceDigest(
  header: TraceInputHeader,
  collection: ExecutionTraceHeaderRecord["collection"],
  scopes: Iterable<string>,
  events: Iterable<string>,
): string {
  const hash = createHash("sha256");
  hash.update(canonicalItem(header)).update("\n").update(canonicalItem(collection)).update("\n");
  for (const scope of scopes) hash.update(scope).update("\n");
  hash.update("\n");
  for (const event of events) hash.update(event).update("\n");
  return hash.digest("hex");
}

function* canonicalItems(values: Iterable<unknown>): Generator<string> {
  for (const value of values) yield canonicalItem(value);
}

function plainFields(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    throw traceError("execution-trace-invalid", "Execution trace stream envelope is invalid.");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== null && prototype !== Object.prototype) {
    throw traceError("execution-trace-invalid", "Execution trace stream envelope must be a plain object.");
  }
  const fields: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    const property = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== "string" || !allowed.includes(key) || property?.enumerable !== true || !("value" in property)) {
      throw traceError("execution-trace-invalid", "Execution trace stream envelope contains an invalid field.");
    }
    fields[key] = property.value;
  }
  return fields;
}

function streamInput(input: ExecutionTraceStreamInput): {
  readonly header: TraceInputHeader;
  readonly start: ExecutionTraceStreamInput["events"]["stream"];
  readonly caller: AbortSignal | undefined;
} {
  const { events, signal, ...fields } = plainFields(input, ["traceId", "schema", "archive", "events", "signal"]);
  const { stream } = plainFields(events, ["stream"]);
  if (typeof stream !== "function" || (signal !== undefined && !(signal instanceof AbortSignal))) {
    throw traceError("execution-trace-invalid", "Execution trace stream factory or signal is invalid.");
  }
  const json = snapshotTraceJson(fields);
  if (Result.isFailure(json)) throw traceError("execution-trace-invalid", "Execution trace header is not plain JSON.");
  const header = decodeStreamHeader(json.success);
  if (Result.isFailure(header)) throw invalidEnvelope(header.failure);
  return { header: header.success, start: stream as ExecutionTraceStreamInput["events"]["stream"], caller: signal };
}

function collectionDeclaration(collection: ExecutionTraceHeaderRecord["collection"]): void {
  if (collection.limitations.some(({ code }) => code.startsWith("niceeval."))) {
    throw traceError(
      "execution-trace-invalid",
      "Execution trace limitation codes starting with niceeval. are reserved.",
    );
  }
}

function freezeCollection(collection: ExecutionTraceHeaderRecord["collection"]): void {
  for (const limit of collection.limitations) Object.freeze(limit);
  Object.freeze(collection.limitations);
  Object.freeze(collection);
}

function verifyStreamEvent(event: InputEvent, ordinal: number): void {
  verifyDisplay(event, ordinal);
  const evidenceKeys = new Set<string>();
  for (const evidence of event.evidence ?? []) {
    if (evidenceKeys.has(evidence.key) || jsonPointerSegments(evidence.pointer) === undefined) {
      throw traceError("execution-trace-invalid", "Execution trace evidence key or pointer is invalid.");
    }
    evidenceKeys.add(evidence.key);
  }
  const memberships = new Set<string>();
  for (const { scopeId } of event.scopeMemberships ?? []) {
    if (memberships.has(scopeId)) {
      throw traceError(
        "execution-trace-invalid",
        "Execution trace memberships must uniquely reference declared scopes.",
      );
    }
    memberships.add(scopeId);
  }
}

function receiptEvent(record: ExecutionTraceEventRecord): ExecutionTraceReceipt["events"][number] {
  return Object.freeze({
    key: record.key,
    eventId: record.eventId,
    evidence: Object.freeze(record.evidence.map(({ key, evidenceId }) => Object.freeze({ key, evidenceId }))),
  });
}

function arrayReceipt(trace: AcceptedExecutionTrace | AcceptedStreamTrace): ExecutionTraceReceipt {
  if (trace.mode === "array") return trace.receipt;
  if (trace.arrayReceipt !== undefined) return trace.arrayReceipt;
  const events: ExecutionTraceReceipt["events"][number][] = [];
  for (const record of trace.records) if (record.kind === "event") events.push(receiptEvent(record));
  return (trace.arrayReceipt = Object.freeze({
    state: "accepted",
    traceId: trace.summary.traceId,
    events: Object.freeze(events),
  }));
}

const TRACE_BATCH_ROWS = 64;
const TRACE_BATCH_BYTES = 256 * 1024;

interface StreamSubmission {
  readonly producer: ReturnType<typeof streamInput>;
  readonly pull: AdapterTracePull;
  readonly resolve: (receipt: ExecutionTraceStreamReceipt) => void;
  readonly reject: (cause: unknown) => void;
  readonly promise: Promise<ExecutionTraceStreamReceipt>;
  running: boolean;
}

async function consumeTrace(
  submission: StreamSubmission,
  artifacts: () => readonly CapturedAdapterAttachment[],
  traceId: string,
  staging: AdapterTraceStaging,
): Promise<AcceptedStreamTrace & { readonly accept: () => Promise<void> }> {
  const {
    producer: { header: source, start },
    pull,
  } = submission;
  const verifiedTargets = staging.evidenceCache("capture");
  let iterator: AsyncIterator<ExecutionTraceStreamItem> | undefined;
  let cut = pull.cut;
  let collection: ExecutionTraceHeaderRecord["collection"] | undefined;
  let total = 0;
  let scopeOrdinal = 0;
  let eventOrdinal = 0;
  let batch: StagedTraceItem[] = [];
  let batchBytes = 0;
  const flush = () => {
    staging.append(batch);
    batch = [];
    batchBytes = 0;
  };

  try {
    if (cut === undefined) {
      try {
        iterator = start(pull.signal)[Symbol.asyncIterator]();
        if (typeof iterator.next !== "function") throw new TypeError("Expected an async iterator.");
      } catch {
        cut = pull.cut ?? "producer-error";
      }
    }
    while (iterator !== undefined && cut === undefined && collection === undefined) {
      const next = await pull.next(iterator);
      cut = pull.cut ?? (next.kind === "cut" ? next.reason : undefined);
      if (cut !== undefined || next.kind === "cut") break;
      if (next.item.done) {
        cut = "unterminated";
        break;
      }
      const json = snapshotTraceJson(next.item.value);
      if (Result.isFailure(json)) {
        throw traceError("execution-trace-invalid", "Execution trace stream item is not finite plain JSON.");
      }
      const decoded = decodeStreamItem(json.success);
      if (Result.isFailure(decoded))
        throw traceError("execution-trace-invalid", "Execution trace stream item is invalid.");
      const item = decoded.success;
      if (item.kind === "end") {
        collectionDeclaration(item.collection);
        collection = item.collection;
        break;
      }
      let record: StagedTraceItem["record"];
      if (item.kind === "scope") {
        record = { kind: "scope", traceId, ordinal: scopeOrdinal++, scope: item.scope };
      } else {
        verifyStreamEvent(item.event, eventOrdinal);
        const needsArtifacts =
          (item.event.evidence?.length ?? 0) > 0 || item.event.display?.some(({ kind }) => kind === "image");
        const attached = needsArtifacts ? artifacts().map((artifact) => [artifact.artifactId, artifact] as const) : [];
        record = durableEvent(
          traceId,
          stableId("ee"),
          eventOrdinal++,
          item.event,
          new Map(attached),
          new Map(),
          verifiedTargets,
          () => stableId("ev"),
        );
      }
      const canonical = canonicalItem(item.kind === "scope" ? item.scope : item.event);
      const encoded = canonicalItem(record);
      const size = Buffer.byteLength(canonical) + Buffer.byteLength(encoded);
      if (batch.length > 0 && batchBytes + size > TRACE_BATCH_BYTES) flush();
      batch.push({ sequence: total++, record, canonical, encoded });
      batchBytes += size;
      if (batch.length >= TRACE_BATCH_ROWS || batchBytes >= TRACE_BATCH_BYTES) {
        flush();
        await setImmediate();
      }
    }
  } finally {
    pull.close(iterator);
  }

  flush();
  const end = await staging.prefix(total, collection !== undefined);
  await staging.verifyCauses(end);
  const counts = staging.counts(end);
  const droppedItems = total - end;
  const reason = cut ?? "unterminated";
  const ending =
    collection === undefined ? { kind: "cut" as const, reason, droppedItems } : { kind: "declared" as const };

  collection ??= {
    state: "partial",
    limitations: [
      {
        code: "niceeval.trace-stream-cut",
        message: "Trace stream cut: " + reason + ". Dropped items: " + droppedItems + ".",
      },
    ],
  };
  freezeCollection(collection);
  Object.freeze(ending);
  const canonicalInputDigest = traceDigest(
    source,
    collection,
    staging.canonical("scope", end),
    staging.canonical("event", end),
  );
  const header: ExecutionTraceHeaderRecord = {
    kind: "trace-header",
    traceId,
    sourceTraceId: source.traceId,
    schema: source.schema,
    ...(source.archive === undefined ? {} : { archive: source.archive }),
    collection,
    index: "published",
    scopes: [],
    ...counts,
  };
  const summary: ExecutionTraceStreamReceipt = Object.freeze({
    state: "accepted",
    traceId,
    collection,
    ending,
    ...counts,
  });
  return {
    mode: "stream",
    staging,
    summary,
    canonicalInputDigest,
    accept: () => staging.accept(end, total, canonicalItem(header), canonicalInputDigest),
    records: { [Symbol.iterator]: () => staging.records() },
  };
}

export function createAdapterExecutionTraceCollector(
  artifacts: () => readonly CapturedAdapterAttachment[],
  options: {
    readonly diagnostic: (input: DiagnosticInput) => void;
    readonly track: (promise: Promise<ExecutionTraceStreamReceipt>) => void;
  },
): AdapterExecutionTraceCollector {
  const accepted = new Map<string, AcceptedExecutionTrace | AcceptedStreamTrace>();
  const submissions = new Map<string, StreamSubmission>();
  let running = 0;
  let storageFailure: SqliteRecordError | undefined;
  let arrayFailure: AdapterExecutionTraceError | undefined;
  let closing: Promise<void> | undefined;
  const acceptedIds = new Set<string>();
  let closed = false;
  let firstFailure: AdapterExecutionTraceError | undefined;
  let sealed: AdapterExecutionTraceSnapshot | undefined;

  const mintStableId = (prefix: "et" | "ee" | "ev", pending: Set<string>): string => {
    let candidate: string;
    do candidate = stableId(prefix);
    while (acceptedIds.has(candidate) || pending.has(candidate));
    pending.add(candidate);
    return candidate;
  };

  const fail = (cause: unknown): AdapterExecutionTraceError => {
    const error =
      cause instanceof AdapterExecutionTraceError
        ? cause
        : traceError("execution-trace-failed", "Execution trace capture failed.");
    if (!closed) {
      firstFailure ??= error;
      arrayFailure ??= error;
    }
    return error;
  };

  const recordArray = (input: ExecutionTraceInput): Promise<ExecutionTraceReceipt> => {
    try {
      if (closed) throw traceError("execution-trace-closed", "Execution trace collection is closed.");
      const canonical = snapshotTraceJson(input);
      if (Result.isFailure(canonical)) {
        if (canonical.failure.path[0] === "events" && canonical.failure.path[2] === "display") {
          const path = canonical.failure.path
            .map((part) => (/^\d+$/u.test(part) ? `[${part}]` : `.${part}`))
            .join("")
            .replace(/^\./u, "");
          throw traceError(
            "execution-display-invalid",
            `${path}: display must contain finite plain JSON and valid UTF-8 text.`,
          );
        }
        throw traceError("execution-trace-invalid", "Execution trace must be finite plain JSON with valid UTF-8 text.");
      }
      const decoded = exactDecode(canonical.success);
      if (Result.isFailure(decoded)) throw invalidEnvelope(decoded.failure);
      const snapshot = decoded.success;
      if (submissions.has(snapshot.traceId)) {
        const error = traceError("execution-trace-conflict", "An execution trace stream for traceId is already open.");
        captureFailure(error, snapshot.traceId);
        return rejectSettled(error);
      }
      verifySemantics(snapshot);
      const { events, scopes, collection, ...headerInput } = snapshot;
      freezeCollection(collection);
      const canonicalInputDigest = traceDigest(headerInput, collection, canonicalItems(scopes), canonicalItems(events));

      const prior = accepted.get(snapshot.traceId);
      if (prior !== undefined) {
        if (prior.canonicalInputDigest !== canonicalInputDigest) {
          throw traceError("execution-trace-conflict", "Conflicting snapshot for execution trace traceId.");
        }
        return Promise.resolve(arrayReceipt(prior));
      }
      const byArtifactId = new Map(artifacts().map((artifact) => [artifact.artifactId, artifact] as const));
      const parsedArtifacts = new Map<string, unknown>();
      const verifiedTargets = new Map<string, VerifiedEvidenceTarget>();
      const pendingIds = new Set<string>();
      const traceId = mintStableId("et", pendingIds);
      const receiptEvents: Array<ExecutionTraceReceipt["events"][number]> = [];
      let evidenceCount = 0;
      const records: ExecutionTraceRecord[] = [];
      const header: ExecutionTraceHeaderRecord = {
        kind: "trace-header",
        traceId,
        sourceTraceId: snapshot.traceId,
        schema: snapshot.schema,
        ...(snapshot.archive === undefined ? {} : { archive: snapshot.archive }),
        collection,
        index: "published",
        scopes: snapshot.scopes.map((scope) => ({
          scopeId: scope.scopeId,
          label: scope.label,
          boundary: scope.boundary,
        })),
      };
      records.push(header);

      for (const [ordinal, event] of snapshot.events.entries()) {
        const eventId = mintStableId("ee", pendingIds);
        const durable = durableEvent(
          traceId,
          eventId,
          ordinal,
          event,
          byArtifactId,
          parsedArtifacts,
          verifiedTargets,
          () => mintStableId("ev", pendingIds),
        );
        records.push(durable);
        receiptEvents.push(receiptEvent(durable));
        evidenceCount += durable.evidence.length;
      }

      const receipt: ExecutionTraceReceipt = Object.freeze({
        state: "accepted",
        traceId,
        events: Object.freeze(receiptEvents),
      });
      const retained: AcceptedExecutionTrace = {
        mode: "array",
        summary: Object.freeze({
          state: "accepted",
          traceId,
          ending: Object.freeze({ kind: "declared" as const }),
          collection,
          scopeCount: scopes.length,
          eventCount: events.length,
          evidenceCount,
        }),
        sourceTraceId: snapshot.traceId,
        canonicalInputDigest,
        receipt,
        records,
      };
      accepted.set(snapshot.traceId, retained);
      for (const id of pendingIds) acceptedIds.add(id);
      return Promise.resolve(receipt);
    } catch (cause) {
      return rejectSettled(fail(cause));
    }
  };

  function captureFailure(error: AdapterExecutionTraceError, traceId?: string): void {
    firstFailure ??= error;
    options.diagnostic({
      level: "warning",
      code: error.code,
      message: traceId === undefined ? error.message : JSON.stringify(traceId) + ": " + error.message,
    });
  }

  async function admit(submission: StreamSubmission): Promise<void> {
    const sourceTraceId = submission.producer.header.traceId;
    let staging: AdapterTraceStaging | undefined;
    try {
      staging = new AdapterTraceStaging();
      const candidate = await consumeTrace(submission, artifacts, stableId("et"), staging);
      const prior = accepted.get(sourceTraceId);
      if (prior !== undefined && prior.canonicalInputDigest !== candidate.canonicalInputDigest) {
        throw traceError("execution-trace-conflict", "Conflicting snapshot for execution trace traceId.");
      }
      if (prior === undefined) {
        await candidate.accept();
        accepted.set(sourceTraceId, candidate);
        staging = undefined;
        const ending = candidate.summary.ending;
        if (ending.kind === "cut")
          options.diagnostic({
            code: "niceeval.trace-stream-cut",
            level: "warning",
            message:
              "Trace " +
              JSON.stringify(sourceTraceId) +
              " cut: " +
              ending.reason +
              ". Dropped items: " +
              ending.droppedItems +
              ".",
          });
      }
      submission.resolve((prior ?? candidate).summary);
    } catch (cause) {
      const error =
        cause instanceof AdapterExecutionTraceError
          ? cause
          : cause instanceof InvalidStagedTrace
            ? traceError("execution-trace-invalid", cause.message)
            : traceError("execution-trace-failed", "Execution trace storage failed.");
      if (!(cause instanceof AdapterExecutionTraceError) && !(cause instanceof InvalidStagedTrace)) {
        storageFailure ??= sqliteError("record-sqlite-error", "stage-execution-trace", error.message, cause);
      }
      captureFailure(error, sourceTraceId);
      submission.reject(error);
    } finally {
      staging?.close();
      submissions.delete(sourceTraceId);
      running -= 1;
      schedule();
    }
  }

  function schedule(): void {
    if (running >= 4) return;
    for (const submission of submissions.values()) {
      if (submission.running) continue;
      submission.running = true;
      running += 1;
      void admit(submission);
      if (running >= 4) break;
    }
  }

  function recordStream(input: ExecutionTraceStreamInput): Promise<ExecutionTraceStreamReceipt> {
    if (closed) return rejectSettled(traceError("execution-trace-closed", "Execution trace collection is closed."));
    try {
      const producer = streamInput(input);
      if (submissions.has(producer.header.traceId)) {
        throw traceError("execution-trace-conflict", "An execution trace stream for traceId is already open.");
      }
      let resolve!: StreamSubmission["resolve"];
      let reject!: StreamSubmission["reject"];
      const promise = new Promise<ExecutionTraceStreamReceipt>((accept, fail) => {
        resolve = accept;
        reject = fail;
      });
      void promise.catch(() => undefined);
      submissions.set(producer.header.traceId, {
        producer,
        pull: new AdapterTracePull(producer.caller),
        resolve,
        reject,
        promise,
        running: false,
      });
      options.track(promise);
      schedule();
      return promise;
    } catch (cause) {
      const error =
        cause instanceof AdapterExecutionTraceError
          ? cause
          : traceError("execution-trace-invalid", "Execution trace stream envelope is invalid.");
      captureFailure(error);
      return rejectSettled(error);
    }
  }

  function recordTrace(input: ExecutionTraceInput): Promise<ExecutionTraceReceipt>;
  function recordTrace(input: ExecutionTraceStreamInput): Promise<ExecutionTraceStreamReceipt>;
  function recordTrace(
    input: ExecutionTraceInput | ExecutionTraceStreamInput,
  ): Promise<ExecutionTraceReceipt | ExecutionTraceStreamReceipt> {
    if (closed) return rejectSettled(traceError("execution-trace-closed", "Execution trace collection is closed."));
    try {
      const events =
        input === null || typeof input !== "object"
          ? undefined
          : Object.getOwnPropertyDescriptor(input, "events")?.value;
      return events !== null && typeof events === "object" && !Array.isArray(events)
        ? recordStream(input as ExecutionTraceStreamInput)
        : recordArray(input as ExecutionTraceInput);
    } catch {
      return rejectSettled(fail(traceError("execution-trace-invalid", "Execution trace input is invalid.")));
    }
  }

  return {
    recordTrace,
    failure: () => arrayFailure,
    close: () => {
      if (closing !== undefined) return closing;
      closed = true;
      const pending = [...submissions.values()];
      for (const submission of pending) submission.pull.stop("admission-closed");
      closing = Promise.allSettled(pending.map((submission) => submission.promise)).then(() => {
        sealed = { traces: [...accepted.values()], failure: firstFailure, storageFailure };
      });
      return closing;
    },
    dispose: () => {
      for (const trace of accepted.values()) if (trace.mode === "stream") trace.staging.close();
    },
    snapshot: () => {
      if (sealed === undefined) throw new Error("Execution trace collection must close before taking its snapshot.");
      return sealed;
    },
  };
}

function validateEventEvidence(
  record: ExecutionTraceEventRecord,
  byArtifactId: ReadonlyMap<string, CapturedAdapterAttachment>,
  parsedArtifacts: Map<string, unknown>,
  verifiedTargets: TraceEvidenceCache,
): void {
  for (const block of record.display ?? []) {
    if (block.kind !== "image") continue;
    const artifact = byArtifactId.get(block.artifactId);
    if (
      artifact === undefined ||
      artifact.sha256 !== block.sha256 ||
      artifact.byteLength !== block.byteLength ||
      artifact.mediaType !== block.mediaType
    ) {
      throw traceError("execution-trace-evidence-missing", "Execution display image artifact closure is invalid.");
    }
  }
  for (const evidence of record.evidence) {
    const artifact = byArtifactId.get(evidence.artifactId);
    if (artifact === undefined || artifact.sha256 !== evidence.artifactSha256) {
      throw traceError("execution-trace-evidence-missing", "Execution trace evidence artifact closure is invalid.");
    }
    const key = JSON.stringify([artifact.artifactId, artifact.sha256, evidence.pointer]);
    let verified = verifiedTargets.get(key);
    if (verified === undefined) {
      const artifactCacheKey = `${artifact.artifactId}\u0000${artifact.sha256}`;
      let artifactJson = parsedArtifacts.get(artifactCacheKey);
      if (artifactJson === undefined) {
        artifactJson = parseArtifactJson(artifact);
        parsedArtifacts.set(artifactCacheKey, artifactJson);
      }
      const target = resolvePointer(artifactJson, evidence.pointer);
      if (target === undefined)
        throw traceError("execution-trace-evidence-missing", "Execution trace evidence pointer closure is invalid.");
      const canonical = snapshotTraceJson(target);
      if (Result.isFailure(canonical))
        throw traceError(
          "execution-trace-evidence-missing",
          "Execution trace evidence target is invalid at publication.",
        );
      const targetIdentity = digestCanonicalTraceJson(canonical.success);
      verified = {
        artifactSha256: artifact.sha256,
        targetSha256: targetIdentity.sha256,
        targetByteLength: targetIdentity.byteLength,
      };
      verifiedTargets.set(key, verified);
    }
    if (verified.targetSha256 !== evidence.targetSha256 || verified.targetByteLength !== evidence.targetByteLength) {
      throw traceError(
        "execution-trace-evidence-missing",
        "Execution trace evidence target digest closure is invalid.",
      );
    }
  }
}

/**
 * Fixed-family closure check repeated at publication. It deliberately uses
 * the durable records, not the original public input, so no bare artifactId
 * can cross the Attempt publication gate.
 */
export function validateExecutionTracePublication(
  snapshot: AdapterExecutionTraceSnapshot,
  artifacts: readonly CapturedAdapterAttachment[],
): void {
  const byArtifactId = new Map(artifacts.map((artifact) => [artifact.artifactId, artifact] as const));
  const parsedArtifacts = new Map<string, unknown>();
  const verifiedTargets = new Map<string, VerifiedEvidenceTarget>();
  const traceIds = new Set<string>();
  const sourceTraceIds = new Set<string>();
  for (const trace of snapshot.traces) {
    if (trace.mode === "stream") {
      if (!trace.staging.requiresArtifactVerification) continue;
      const cache = trace.staging.evidenceCache("publication");
      for (const record of trace.records) {
        if (record.kind === "event") validateEventEvidence(record, byArtifactId, new Map(), cache);
      }
      continue;
    }
    const header = trace.records[0];
    const eventCount = trace.records.length - 1;
    if (
      header?.kind !== "trace-header" ||
      header.traceId !== trace.receipt.traceId ||
      traceIds.has(header.traceId) ||
      sourceTraceIds.has(header.sourceTraceId) ||
      eventCount !== trace.receipt.events.length
    ) {
      throw traceError("execution-trace-failed", "Execution trace durable header is invalid.");
    }
    traceIds.add(header.traceId);
    sourceTraceIds.add(header.sourceTraceId);
    const scopeIds = new Set<string>();
    for (const scope of header.scopes) {
      if (scopeIds.has(scope.scopeId))
        throw traceError("execution-trace-failed", "Execution trace durable scopes are invalid.");
      scopeIds.add(scope.scopeId);
    }
    const eventKeys = new Set<string>();
    const eventIds = new Set<string>();
    const evidenceIds = new Set<string>();
    const causeEdges = new Map<string, string[]>();
    const clockUnits = new Map<string, string>();
    for (let index = 1; index < trace.records.length; index += 1) {
      const record = trace.records[index]!;
      const receiptEvent = trace.receipt.events[record.kind === "event" ? record.ordinal : -1];
      if (
        record.kind !== "event" ||
        record.traceId !== header.traceId ||
        record.ordinal < 0 ||
        record.ordinal >= eventCount ||
        receiptEvent?.key !== record.key ||
        receiptEvent.eventId !== record.eventId ||
        eventKeys.has(record.key) ||
        eventIds.has(record.eventId)
      ) {
        throw traceError("execution-trace-failed", "Execution trace durable event ownership is invalid.");
      }
      eventKeys.add(record.key);
      eventIds.add(record.eventId);
      const evidenceKeys = new Set<string>();
      for (const [index, evidence] of record.evidence.entries()) {
        if (
          evidenceKeys.has(evidence.key) ||
          evidenceIds.has(evidence.evidenceId) ||
          receiptEvent.evidence[index]?.key !== evidence.key ||
          receiptEvent.evidence[index]?.evidenceId !== evidence.evidenceId
        ) {
          throw traceError("execution-trace-failed", "Execution trace durable evidence identity is invalid.");
        }
        evidenceKeys.add(evidence.key);
        evidenceIds.add(evidence.evidenceId);
      }
      if (receiptEvent.evidence.length !== record.evidence.length) {
        throw traceError("execution-trace-failed", "Execution trace durable evidence receipt is invalid.");
      }
      const memberships = new Set<string>();
      for (const membership of record.scopeMemberships) {
        if (!scopeIds.has(membership.scopeId) || memberships.has(membership.scopeId)) {
          throw traceError("execution-trace-failed", "Execution trace durable membership is invalid.");
        }
        memberships.add(membership.scopeId);
      }
      if (record.time !== undefined) {
        const priorUnit = clockUnits.get(record.time.clockId);
        if (priorUnit !== undefined && priorUnit !== record.time.unit) {
          throw traceError("execution-trace-failed", "Execution trace durable clock unit is invalid.");
        }
        clockUnits.set(record.time.clockId, record.time.unit);
      }
      for (const link of record.links) {
        if ("targetKey" in link && link.relation === "causes") {
          const targets = causeEdges.get(record.key) ?? [];
          targets.push(link.targetKey);
          causeEdges.set(record.key, targets);
        }
      }
      validateEventEvidence(record, byArtifactId, parsedArtifacts, verifiedTargets);
    }
    for (let index = 1; index < trace.records.length; index += 1) {
      const record = trace.records[index]!;
      if (record.kind !== "event") continue;
      for (const link of record.links) {
        if ("targetKey" in link && !eventKeys.has(link.targetKey)) {
          throw traceError("execution-trace-failed", "Execution trace durable resolved link is invalid.");
        }
      }
    }
    if (causesCycle([...eventKeys], causeEdges)) {
      throw traceError("execution-trace-failed", "Execution trace durable causes links contain a cycle.");
    }
  }
}
