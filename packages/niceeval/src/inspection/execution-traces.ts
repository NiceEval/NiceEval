import { Result, Schema } from "effect";

import {
  canonicalizeRecordJson,
  canonicalRecordJsonText,
  type RecordJson,
} from "../record/definition/canonical.ts";
import type { AttemptRecordCollectionLimitation } from "../record/authoring.ts";
import { executionTracesRecordCollection } from "../record/family/execution-traces/definition.ts";
import {
  ExecutionTraceRecordLimits,
  ExecutionTraceRecordSchema,
  type ExecutionTraceEventRecord,
  type ExecutionTraceHeaderRecord,
} from "../record/family/execution-traces/schema.ts";
import type { DecodedInspectionAttachment, ResolvedInspectionAttempt } from "./facts.ts";
import { readInspectionArtifactBytes, type InspectionArtifactBytes } from "./artifacts.ts";
import {
  decodeBase64UrlUtf8,
  encodeBase64Bytes,
  encodeBase64UrlUtf8,
  InspectionSha256,
  utf8ByteLength,
} from "./bytes.ts";
import type { InspectionFactSource } from "./source.ts";
import { INSPECTION_BEHAVIOR_VERSION } from "./protocol-values.ts";

export const EXECUTION_TRACE_FAMILY_REVISION = 1 as const;

const PAGE_ROWS = 64;
const IDENTITY_INDEX_LIMIT = 256;
const TARGET_LIMITS = Object.freeze({
  maximumJsonBytes: ExecutionTraceRecordLimits.maximumEvidenceTargetBytes,
  maximumDepth: ExecutionTraceRecordLimits.maximumJsonDepth,
  maximumNodes: 70_000_000,
  maximumObjectKeys: 40_000_000,
  maximumArrayItems: 70_000_000,
  maximumKeyUtf8Bytes: ExecutionTraceRecordLimits.maximumEvidenceTargetBytes,
  maximumStringUtf8Bytes: ExecutionTraceRecordLimits.maximumEvidenceTargetBytes,
});
const PAYLOAD_LIMITS = Object.freeze({
  maximumJsonBytes: ExecutionTraceRecordLimits.maximumPayloadBytes,
  maximumDepth: ExecutionTraceRecordLimits.maximumJsonDepth,
  maximumNodes: 20_000,
  maximumObjectKeys: 10_000,
  maximumArrayItems: 20_000,
  maximumKeyUtf8Bytes: ExecutionTraceRecordLimits.maximumPayloadBytes,
  maximumStringUtf8Bytes: ExecutionTraceRecordLimits.maximumPayloadBytes,
});
const SCOPE_BOUNDARY_LIMITS = Object.freeze({
  maximumJsonBytes: ExecutionTraceRecordLimits.maximumCanonicalInputBytes,
  maximumDepth: ExecutionTraceRecordLimits.maximumJsonDepth,
  maximumNodes: 40_000_000,
  maximumObjectKeys: 20_000_000,
  maximumArrayItems: 40_000_000,
  maximumKeyUtf8Bytes: ExecutionTraceRecordLimits.maximumCanonicalInputBytes,
  maximumStringUtf8Bytes: ExecutionTraceRecordLimits.maximumCanonicalInputBytes,
});
const utf8 = new TextEncoder();

export interface ExecutionTraceFilters {
  readonly traceId?: string;
  readonly sourceId?: string;
  readonly actorId?: string;
}

export interface ExecutionTraceOutlineRequest extends ExecutionTraceFilters {
  readonly continuation?: string;
}

export type ExecutionTraceDetailSelector =
  | { readonly kind: "execution-event"; readonly eventId: string }
  | {
      readonly kind: "execution-evidence";
      readonly evidenceId: string;
      readonly offset?: number;
      readonly limit?: number;
    };

export interface ExecutionTraceOutlineResult {
  readonly state: "complete" | "partial" | "not-recorded" | "invalid";
  readonly limitations: readonly (
    | { readonly code: "capture-failed"; readonly stage: "adapter" }
    | { readonly code: "capture-interrupted"; readonly stage: "attempt-finalizer" }
    | { readonly code: "collection-cap-reached"; readonly omittedAtLeast: number }
    | { readonly code: "legacy-source-state"; readonly state: "partial" | "invalid"; readonly message: string }
  )[];
  readonly traces: readonly (ExecutionTraceHeaderRecord & { readonly eventCount: number })[];
  readonly events: readonly ExecutionTraceEventOutline[];
  readonly identityIndex: {
    readonly traceIds: readonly string[];
    readonly omittedTraceIdCount: number;
    readonly eventIds: readonly string[];
    readonly omittedEventIdCount: number;
    readonly evidenceIds: readonly string[];
    readonly omittedEvidenceIdCount: number;
  };
  readonly hasMore: boolean;
  readonly omittedEventCount: number;
  readonly continuation?: string;
}

export interface ExecutionTraceEventOutline {
  readonly traceId: string;
  readonly eventId: string;
  readonly origin:
    | { readonly kind: "execution-event"; readonly eventId: string }
    | { readonly kind: "agent-item"; readonly itemId: string };
  readonly ordinal: number;
  readonly type: string;
  readonly source: ExecutionTraceEventRecord["source"];
  readonly actor?: ExecutionTraceEventRecord["actor"];
  readonly time?: ExecutionTraceEventRecord["time"];
  readonly summary: string;
  readonly links: ExecutionTraceEventRecord["links"];
  readonly evidence: readonly {
    readonly evidenceId: string;
    readonly key: string;
    readonly label: string;
  }[];
  readonly scopeMemberships: ExecutionTraceEventRecord["scopeMemberships"];
}

export type ExecutionTraceDetailResult =
  | {
      readonly kind: "execution-event";
      readonly event: ExecutionTraceEventRecord;
      readonly evidence: readonly ExecutionEvidencePreview[];
    }
  | ({ readonly kind: "execution-evidence" } & ExecutionEvidenceRange);

export interface ExecutionEvidencePreview {
  readonly evidenceId: string;
  readonly key: string;
  readonly label: string;
  readonly artifactId: string;
  readonly pointer: string;
  readonly targetSha256: string;
  readonly targetByteLength: number;
  readonly offset: 0;
  readonly base64: string;
  readonly nextOffset: number | null;
  readonly truncated: boolean;
}

export interface ExecutionEvidenceRange extends Omit<ExecutionEvidencePreview, "offset" | "truncated"> {
  readonly eventId: string;
  readonly traceId: string;
  readonly artifactSha256: string;
  readonly offset: number;
}

export class InspectionExecutionTraceError extends Error {
  readonly code: "inspection-request-invalid" | "inspection-record-integrity-failure" | "evidence-budget-exceeded" | "restart-required";
  constructor(code: InspectionExecutionTraceError["code"], message: string) {
    super(message);
    this.name = "InspectionExecutionTraceError";
    this.code = code;
  }
}

interface EvidenceTarget {
  readonly bytes: Uint8Array;
  readonly artifact: InspectionArtifactBytes;
  readonly targetSha256: string;
}

interface ScanState {
  readonly headers: Map<string, ExecutionTraceHeaderRecord>;
  readonly sourceTraceIds: Set<string>;
  readonly eventCounts: Map<string, number>;
  readonly eventKeys: Map<string, Set<string>>;
  readonly scopeIds: Map<string, Set<string>>;
  readonly clockUnits: Map<string, Map<string, string>>;
  readonly resolvedLinks: Array<{ readonly traceId: string; readonly targetKey: string }>;
  readonly causeEdges: Map<string, Map<string, string[]>>;
  readonly eventIds: Set<string>;
  readonly evidenceIds: Set<string>;
  readonly traceIdsForIndex: string[];
  readonly eventIdsForIndex: string[];
  readonly evidenceIdsForIndex: string[];
  sourceBytes: number;
  targetBytes: number;
  readonly artifacts: Map<string, InspectionArtifactBytes>;
  readonly parsedArtifacts: Map<string, unknown>;
  readonly targets: Map<string, EvidenceTarget>;
}

function digest(value: Uint8Array | string): string {
  return new InspectionSha256().update(typeof value === "string" ? utf8.encode(value) : value).digestHex();
}

function tupleLengthPrefix(length: number): Uint8Array {
  if (!Number.isSafeInteger(length) || length < 0 || length > 0xffff_ffff) {
    throw integrity("Execution trace collection item identity length is invalid.");
  }
  const prefix = new Uint8Array(4);
  new DataView(prefix.buffer).setUint32(0, length, false);
  return prefix;
}

function updateTuplePart(hash: InspectionSha256, part: string | number): void {
  const tag = typeof part === "string" ? 1 : 2;
  if (typeof part === "number" && !Number.isSafeInteger(part)) {
    throw integrity("Execution trace collection item identity ordinal is invalid.");
  }
  const payload = utf8.encode(String(part));
  hash.update(Uint8Array.of(tag)).update(tupleLengthPrefix(payload.byteLength)).update(payload);
}

function executionCollectionItemLogicalIdentity(ordinal: number, canonicalDigest: string): string {
  return inspectionTupleDigest("niceeval.record.collection-item-logical-identity/v1", [ordinal, canonicalDigest]);
}

function inspectionTupleDigest(domain: string, parts: readonly (string | number)[]): string {
  const hash = new InspectionSha256();
  updateTuplePart(hash, domain);
  for (const part of parts) updateTuplePart(hash, part);
  return hash.digestHex();
}

function parseJson(bytes: Uint8Array, label: string): unknown {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw integrity(`${label} is not UTF-8 JSON.`);
  }
}

function integrity(message: string): InspectionExecutionTraceError {
  return new InspectionExecutionTraceError("inspection-record-integrity-failure", message);
}

function pointerSegments(pointer: string): readonly string[] | undefined {
  if (pointer === "") return [];
  if (!pointer.startsWith("/")) return undefined;
  const output: string[] = [];
  for (const token of pointer.slice(1).split("/")) {
    let decoded = "";
    for (let index = 0; index < token.length; index += 1) {
      if (token[index] !== "~") {
        decoded += token[index];
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
  const segments = pointerSegments(pointer);
  if (segments === undefined) return undefined;
  let current = root;
  for (const segment of segments) {
    if (Array.isArray(current)) {
      if (!/^(?:0|[1-9][0-9]*)$/u.test(segment)) return undefined;
      const index = Number(segment);
      if (!Number.isSafeInteger(index) || index >= current.length || !Object.prototype.hasOwnProperty.call(current, segment)) return undefined;
      current = current[index];
    } else if (typeof current === "object" && current !== null && Object.prototype.hasOwnProperty.call(current, segment)) {
      const descriptor = Object.getOwnPropertyDescriptor(current, segment);
      if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true) return undefined;
      current = descriptor.value;
    } else return undefined;
  }
  return current;
}

function collectionAttachment(resolved: ResolvedInspectionAttempt): DecodedInspectionAttachment | undefined {
  const matches = resolved.origin.attachments.filter(({ physical }) =>
    physical.ownerKind === "attempt" &&
    physical.ownerAttemptId === resolved.attempt.attemptId &&
    physical.family === executionTracesRecordCollection.family);
  if (matches.length > 1) throw integrity("Execution trace owner has duplicate collection attachments.");
  return matches[0];
}

function validateAttachment(
  resolved: ResolvedInspectionAttempt,
  attachment: DecodedInspectionAttachment,
): { readonly collection: {
  readonly state: "complete" | "partial";
  readonly limitations: readonly AttemptRecordCollectionLimitation[];
}; readonly expectedDigest: string } {
  const physical = attachment.physical;
  if (physical.ownerKind !== "attempt" || physical.ownerAttemptId !== resolved.attempt.attemptId ||
    physical.ownerRunId !== resolved.attempt.originRunId || physical.family !== executionTracesRecordCollection.family ||
    physical.familyRevision !== EXECUTION_TRACE_FAMILY_REVISION || physical.references.length !== 0 || physical.contents.length !== 0 ||
    digest(physical.canonicalBytes) !== physical.canonicalDigest || digest(physical.logicalInventoryBytes) !== physical.inventoryDigest ||
    physical.logicalIdentity !== inspectionTupleDigest("niceeval.record.attachment-logical-identity/v1", [
      physical.attachmentId,
      physical.canonicalDigest,
      physical.inventoryDigest,
    ])) {
    throw integrity("Execution trace collection attachment closure is invalid.");
  }
  const shell = Schema.decodeUnknownResult(executionTracesRecordCollection.schema, { onExcessProperty: "error" })(attachment.value);
  if (Result.isFailure(shell) || shell.success.items.length !== 0) throw integrity("Execution trace collection shell is invalid.");
  const inventory = parseJson(physical.logicalInventoryBytes, "Execution trace collection inventory") as {
    readonly collection?: { readonly count?: unknown; readonly byteLength?: unknown; readonly digest?: unknown };
  };
  if (inventory.collection?.count !== physical.collectionItemCount ||
    inventory.collection.byteLength !== physical.collectionItemByteLength ||
    typeof inventory.collection.digest !== "string") throw integrity("Execution trace collection inventory is invalid.");
  return Object.freeze({
    collection: shell.success.collection,
    expectedDigest: inventory.collection.digest,
  });
}

function newScanState(): ScanState {
  return {
    headers: new Map(), sourceTraceIds: new Set(), eventCounts: new Map(), eventKeys: new Map(),
    scopeIds: new Map(), clockUnits: new Map(), resolvedLinks: [], causeEdges: new Map(),
    eventIds: new Set(), evidenceIds: new Set(), traceIdsForIndex: [], eventIdsForIndex: [], evidenceIdsForIndex: [],
    sourceBytes: 0, targetBytes: 0, artifacts: new Map(), parsedArtifacts: new Map(), targets: new Map(),
  };
}

function readArtifact(
  resolved: ResolvedInspectionAttempt,
  state: ScanState,
  artifactId: string,
): InspectionArtifactBytes {
  const cached = state.artifacts.get(artifactId);
  if (cached !== undefined) return cached;
  const read = readInspectionArtifactBytes(resolved, artifactId);
  if (Result.isFailure(read) || read.success === undefined) throw integrity(`Execution evidence artifact ${artifactId} is unavailable.`);
  state.sourceBytes += read.success.byteLength;
  if (state.sourceBytes > ExecutionTraceRecordLimits.maximumEvidenceSourceBytes) {
    throw new InspectionExecutionTraceError("evidence-budget-exceeded", "Execution evidence source budget exceeded.");
  }
  state.artifacts.set(artifactId, read.success);
  return read.success;
}

function verifyEvidence(
  resolved: ResolvedInspectionAttempt,
  state: ScanState,
  evidence: ExecutionTraceEventRecord["evidence"][number],
): EvidenceTarget {
  const artifact = readArtifact(resolved, state, evidence.artifactId);
  if (artifact.sha256 !== evidence.artifactSha256 || artifact.mediaType !== "application/json") {
    throw integrity("Execution evidence artifact digest or media type is invalid.");
  }
  const cacheKey = `${artifact.artifactId}\u0000${artifact.sha256}\u0000${evidence.pointer}`;
  const cached = state.targets.get(cacheKey);
  if (cached !== undefined) {
    if (cached.targetSha256 !== evidence.targetSha256 || cached.bytes.byteLength !== evidence.targetByteLength) {
      throw integrity("Execution evidence target digest is invalid.");
    }
    return cached;
  }
  let parsed = state.parsedArtifacts.get(artifact.artifactId);
  if (parsed === undefined) {
    parsed = parseJson(artifact.bytes, `Execution evidence artifact ${artifact.artifactId}`);
    state.parsedArtifacts.set(artifact.artifactId, parsed);
  }
  const target = resolvePointer(parsed, evidence.pointer);
  if (target === undefined) throw integrity("Execution evidence JSON pointer does not resolve.");
  const canonical = canonicalizeRecordJson(target, TARGET_LIMITS);
  if (Result.isFailure(canonical)) throw integrity("Execution evidence target is not bounded finite JSON.");
  const bytes = utf8.encode(canonicalRecordJsonText(canonical.success as RecordJson));
  state.targetBytes += bytes.byteLength;
  if (state.targetBytes > ExecutionTraceRecordLimits.maximumEvidenceTargetBytes) {
    throw new InspectionExecutionTraceError("evidence-budget-exceeded", "Execution evidence target budget exceeded.");
  }
  if (digest(bytes) !== evidence.targetSha256 || bytes.byteLength !== evidence.targetByteLength) {
    throw integrity("Execution evidence target digest or length is invalid.");
  }
  const verified = Object.freeze({ bytes, artifact, targetSha256: evidence.targetSha256 });
  state.targets.set(cacheKey, verified);
  return verified;
}

function observeRecord(
  resolved: ResolvedInspectionAttempt,
  state: ScanState,
  record: Schema.Schema.Type<typeof ExecutionTraceRecordSchema>,
): void {
  if (record.kind === "trace-header") {
    if (state.headers.has(record.traceId) || state.sourceTraceIds.has(record.sourceTraceId)) {
      throw integrity("Execution trace identities are duplicated.");
    }
    state.headers.set(record.traceId, record);
    state.sourceTraceIds.add(record.sourceTraceId);
    state.eventCounts.set(record.traceId, 0);
    state.eventKeys.set(record.traceId, new Set());
    const scopeIds = new Set<string>();
    for (const scope of record.scopes) {
      if (scopeIds.has(scope.scopeId) || Result.isFailure(canonicalizeRecordJson(scope.boundary, SCOPE_BOUNDARY_LIMITS))) {
        throw integrity("Execution trace scope identity or boundary is invalid.");
      }
      scopeIds.add(scope.scopeId);
    }
    state.scopeIds.set(record.traceId, scopeIds);
    state.clockUnits.set(record.traceId, new Map());
    state.causeEdges.set(record.traceId, new Map());
    if (state.traceIdsForIndex.length < IDENTITY_INDEX_LIMIT) state.traceIdsForIndex.push(record.traceId);
    return;
  }
  const header = state.headers.get(record.traceId);
  const keys = state.eventKeys.get(record.traceId);
  const expectedOrdinal = state.eventCounts.get(record.traceId);
  if (header === undefined || keys === undefined || expectedOrdinal === undefined || record.ordinal !== expectedOrdinal ||
    keys.has(record.key) || state.eventIds.has(record.eventId)) throw integrity("Execution trace event sequence or identity is invalid.");
  keys.add(record.key);
  state.eventIds.add(record.eventId);
  state.eventCounts.set(record.traceId, expectedOrdinal + 1);
  if (state.eventIdsForIndex.length < IDENTITY_INDEX_LIMIT) state.eventIdsForIndex.push(record.eventId);
  if (record.links.length > ExecutionTraceRecordLimits.maximumLinksPerEvent ||
    record.evidence.length > ExecutionTraceRecordLimits.maximumEvidencePerEvent ||
    record.scopeMemberships.length > ExecutionTraceRecordLimits.maximumScopesPerEvent ||
    record.payload !== undefined && Result.isFailure(canonicalizeRecordJson(record.payload, PAYLOAD_LIMITS))) {
    throw integrity("Execution trace event exceeds its fixed semantic limits.");
  }
  const evidenceKeys = new Set<string>();
  for (const evidence of record.evidence) {
    if (evidenceKeys.has(evidence.key) || state.evidenceIds.has(evidence.evidenceId)) throw integrity("Execution evidence identity is duplicated.");
    evidenceKeys.add(evidence.key);
    state.evidenceIds.add(evidence.evidenceId);
    if (state.evidenceIdsForIndex.length < IDENTITY_INDEX_LIMIT) state.evidenceIdsForIndex.push(evidence.evidenceId);
    verifyEvidence(resolved, state, evidence);
  }
  const membershipScopes = new Set<string>();
  const declaredScopes = state.scopeIds.get(record.traceId)!;
  for (const membership of record.scopeMemberships) {
    if (!declaredScopes.has(membership.scopeId) || membershipScopes.has(membership.scopeId)) {
      throw integrity("Execution trace scope membership is invalid.");
    }
    membershipScopes.add(membership.scopeId);
  }
  if (record.time !== undefined) {
    const units = state.clockUnits.get(record.traceId)!;
    const priorUnit = units.get(record.time.clockId);
    if (priorUnit !== undefined && priorUnit !== record.time.unit) {
      throw integrity("Execution trace clock unit changed within one trace.");
    }
    units.set(record.time.clockId, record.time.unit);
  }
  for (const link of record.links) {
    if (!("targetKey" in link)) continue;
    state.resolvedLinks.push(Object.freeze({ traceId: record.traceId, targetKey: link.targetKey }));
    if (link.relation === "causes") {
      const edges = state.causeEdges.get(record.traceId)!;
      const targets = edges.get(record.key) ?? [];
      targets.push(link.targetKey);
      edges.set(record.key, targets);
    }
  }
}

function hasDirectedCycle(keys: ReadonlySet<string>, edges: ReadonlyMap<string, readonly string[]>): boolean {
  const states = new Map<string, "visiting" | "visited">();
  for (const root of keys) {
    if (states.get(root) === "visited") continue;
    const stack: Array<{ readonly key: string; next: number }> = [{ key: root, next: 0 }];
    states.set(root, "visiting");
    while (stack.length > 0) {
      const frame = stack[stack.length - 1]!;
      const target = (edges.get(frame.key) ?? [])[frame.next];
      if (target === undefined) {
        states.set(frame.key, "visited");
        stack.pop();
        continue;
      }
      frame.next += 1;
      const targetState = states.get(target);
      if (targetState === "visiting") return true;
      if (targetState === "visited") continue;
      states.set(target, "visiting");
      stack.push({ key: target, next: 0 });
    }
  }
  return false;
}

function validateScanSemantics(state: ScanState): void {
  if (state.headers.size > ExecutionTraceRecordLimits.maximumTraces ||
    state.eventIds.size > ExecutionTraceRecordLimits.maximumEvents) {
    throw integrity("Execution trace collection exceeds its fixed trace or event limit.");
  }
  for (const link of state.resolvedLinks) {
    if (!state.eventKeys.get(link.traceId)?.has(link.targetKey)) {
      throw integrity("Resolved execution trace link leaves its trace snapshot.");
    }
  }
  for (const [traceId, edges] of state.causeEdges) {
    const keys = state.eventKeys.get(traceId);
    if (keys === undefined || hasDirectedCycle(keys, edges)) {
      throw integrity("Execution trace causes links contain a cycle.");
    }
  }
}

function scanCollection(
  resolved: ResolvedInspectionAttempt,
  visit: (record: Schema.Schema.Type<typeof ExecutionTraceRecordSchema>, collectionOrdinal: number, state: ScanState) => void,
): { readonly state: ScanState; readonly collection: {
  readonly state: "complete" | "partial";
  readonly limitations: readonly AttemptRecordCollectionLimitation[];
} } | undefined {
  const attachment = collectionAttachment(resolved);
  if (attachment === undefined) return undefined;
  const validated = validateAttachment(resolved, attachment);
  const state = newScanState();
  const hash = new InspectionSha256();
  let after = -1;
  let ordinal = 0;
  let byteLength = 0;
  for (;;) {
    const page = resolved.origin.source.readCollectionPage(attachment.physical.attachmentId, after, PAGE_ROWS);
    if (page.attachmentId !== attachment.physical.attachmentId || page.afterOrdinal !== after || page.items.length > PAGE_ROWS ||
      page.items.length === 0 && page.nextOrdinal !== null) throw integrity("Execution trace collection page is invalid.");
    for (const item of page.items) {
      const itemDigest = digest(item.canonicalBytes);
      if (item.ordinal !== ordinal || item.canonicalDigest !== itemDigest ||
        item.logicalIdentity !== executionCollectionItemLogicalIdentity(ordinal, itemDigest)) throw integrity("Execution trace collection item closure is invalid.");
      const decoded = Schema.decodeUnknownResult(ExecutionTraceRecordSchema, { onExcessProperty: "error" })(
        parseJson(item.canonicalBytes, "Execution trace collection item"),
      );
      if (Result.isFailure(decoded)) throw integrity("Execution trace collection item schema is invalid.");
      hash.update(item.canonicalBytes).update(Uint8Array.of(0x0a));
      byteLength += item.canonicalBytes.byteLength;
      observeRecord(resolved, state, decoded.success);
      visit(decoded.success, ordinal, state);
      ordinal += 1;
    }
    if (page.nextOrdinal === null) break;
    if (page.items.length === 0 || page.nextOrdinal !== ordinal - 1) throw integrity("Execution trace collection continuation is invalid.");
    after = page.nextOrdinal;
  }
  if (ordinal !== attachment.physical.collectionItemCount || byteLength !== attachment.physical.collectionItemByteLength ||
    hash.digestHex() !== validated.expectedDigest) throw integrity("Execution trace collection aggregate closure is invalid.");
  validateScanSemantics(state);
  return Object.freeze({ state, collection: validated.collection });
}

function matches(event: ExecutionTraceEventRecord, filters: ExecutionTraceFilters): boolean {
  return (filters.traceId === undefined || event.traceId === filters.traceId) &&
    (filters.sourceId === undefined || event.source.id === filters.sourceId) &&
    (filters.actorId === undefined || event.actor?.id === filters.actorId);
}

export const EXECUTION_TRACE_CONTINUATION_FAMILIES = Object.freeze({
  executionTraces: executionTracesRecordCollection.family,
  agentTurns: "niceeval.agent-turns",
});

interface ContinuationBinding {
  readonly operation: "attempt.trace";
  readonly sourceIdentity: InspectionFactSource["kind"];
  readonly cutoff: string;
  readonly originAttempt: string;
  readonly sourceFamily: string;
  readonly familyRevision: number;
  readonly behaviorVersion: typeof INSPECTION_BEHAVIOR_VERSION;
  readonly filters: { readonly traceId: string | null; readonly sourceId: string | null; readonly actorId: string | null };
  readonly lastOrdinal: number;
}

export interface ExecutionTraceContinuationContext {
  readonly source: InspectionFactSource;
  readonly originAttempt: string;
  readonly sourceFamily: string;
  readonly familyRevision: number;
  readonly filters: ExecutionTraceFilters;
}

function continuationBinding(
  context: ExecutionTraceContinuationContext,
  lastOrdinal: number,
): ContinuationBinding {
  return Object.freeze({
    operation: "attempt.trace",
    sourceIdentity: context.source.kind,
    cutoff: context.source.cutoff().identity,
    originAttempt: context.originAttempt,
    sourceFamily: context.sourceFamily,
    familyRevision: context.familyRevision,
    behaviorVersion: INSPECTION_BEHAVIOR_VERSION,
    filters: Object.freeze({
      traceId: context.filters.traceId ?? null,
      sourceId: context.filters.sourceId ?? null,
      actorId: context.filters.actorId ?? null,
    }),
    lastOrdinal,
  });
}

function nativeContinuationContext(
  source: InspectionFactSource,
  resolved: ResolvedInspectionAttempt,
  filters: ExecutionTraceFilters,
): ExecutionTraceContinuationContext {
  return Object.freeze({
    source,
    originAttempt: `${resolved.attempt.originRunId}:${resolved.attempt.attemptId}`,
    sourceFamily: EXECUTION_TRACE_CONTINUATION_FAMILIES.executionTraces,
    familyRevision: EXECUTION_TRACE_FAMILY_REVISION,
    filters,
  });
}

export function encodeExecutionTraceContinuation(
  context: ExecutionTraceContinuationContext,
  lastOrdinal: number,
): string {
  if (!Number.isSafeInteger(lastOrdinal) || lastOrdinal < 0) {
    throw new InspectionExecutionTraceError("restart-required", "Execution trace continuation binding changed; restart from the first page.");
  }
  return encodeBase64UrlUtf8(JSON.stringify(continuationBinding(context, lastOrdinal)));
}

export function decodeExecutionTraceContinuation(
  token: string,
  context: ExecutionTraceContinuationContext,
): number {
  try {
    const parsed = JSON.parse(decodeBase64UrlUtf8(token)) as ContinuationBinding;
    const expected = continuationBinding(context, parsed.lastOrdinal);
    if (!Number.isSafeInteger(parsed.lastOrdinal) || parsed.lastOrdinal < 0 || JSON.stringify(parsed) !== JSON.stringify(expected)) {
      throw new Error("binding changed");
    }
    return parsed.lastOrdinal;
  } catch {
    throw new InspectionExecutionTraceError("restart-required", "Execution trace continuation binding changed; restart from the first page.");
  }
}

function continuationSourceFamily(token: string): string | undefined {
  try {
    const parsed = JSON.parse(decodeBase64UrlUtf8(token)) as { readonly sourceFamily?: unknown };
    return typeof parsed.sourceFamily === "string" ? parsed.sourceFamily : undefined;
  } catch {
    return undefined;
  }
}

function outlineEvent(event: ExecutionTraceEventRecord): ExecutionTraceEventOutline {
  return Object.freeze({
    traceId: event.traceId,
    eventId: event.eventId,
    origin: Object.freeze({ kind: "execution-event", eventId: event.eventId }),
    ordinal: event.ordinal,
    type: event.type,
    source: event.source,
    ...(event.actor === undefined ? {} : { actor: event.actor }),
    ...(event.time === undefined ? {} : { time: event.time }),
    summary: event.summary,
    links: event.links,
    evidence: Object.freeze(event.evidence.map(({ evidenceId, key, label }) => Object.freeze({ evidenceId, key, label }))),
    scopeMemberships: event.scopeMemberships,
  });
}

export function projectExecutionTraceOutline(
  source: InspectionFactSource,
  resolved: ResolvedInspectionAttempt,
  request: ExecutionTraceOutlineRequest,
): ExecutionTraceOutlineResult {
  const filters: ExecutionTraceFilters = Object.freeze({
    ...(request.traceId === undefined ? {} : { traceId: request.traceId }),
    ...(request.sourceId === undefined ? {} : { sourceId: request.sourceId }),
    ...(request.actorId === undefined ? {} : { actorId: request.actorId }),
  });
  const nativeAttachment = collectionAttachment(resolved);
  if (request.continuation !== undefined && nativeAttachment === undefined &&
    continuationSourceFamily(request.continuation) === EXECUTION_TRACE_CONTINUATION_FAMILIES.agentTurns) {
    return Object.freeze({
      state: "not-recorded", limitations: Object.freeze([]), traces: Object.freeze([]), events: Object.freeze([]),
      identityIndex: Object.freeze({ traceIds: Object.freeze([]), omittedTraceIdCount: 0, eventIds: Object.freeze([]), omittedEventIdCount: 0, evidenceIds: Object.freeze([]), omittedEvidenceIdCount: 0 }),
      hasMore: false, omittedEventCount: 0,
    });
  }
  const continuationContext = nativeContinuationContext(source, resolved, filters);
  const resumeAfter = request.continuation === undefined
    ? -1
    : decodeExecutionTraceContinuation(request.continuation, continuationContext);
  const retained: Array<{ readonly event: ExecutionTraceEventOutline; readonly collectionOrdinal: number }> = [];
  let matched = 0;
  let priorMatches = 0;
  let pageFull = false;
  const matchedTraceIds = new Set<string>();
  const scanned = scanCollection(resolved, (record, collectionOrdinal) => {
    if (record.kind !== "event" || !matches(record, filters)) return;
    matched += 1;
    matchedTraceIds.add(record.traceId);
    if (collectionOrdinal <= resumeAfter) {
      priorMatches += 1;
      return;
    }
    if (pageFull || retained.length >= ExecutionTraceRecordLimits.maximumOutlineEvents) {
      pageFull = true;
      return;
    }
    const candidate = Object.freeze({ event: outlineEvent(record), collectionOrdinal });
    const nextEvents = [...retained.map(({ event }) => event), candidate.event];
    if (utf8ByteLength(JSON.stringify(nextEvents)) > ExecutionTraceRecordLimits.maximumOutlineBytes) {
      if (retained.length === 0) throw integrity("One execution trace outline event exceeds the fixed page budget.");
      pageFull = true;
      return;
    }
    retained.push(candidate);
  });
  if (scanned === undefined) return Object.freeze({
    state: "not-recorded", limitations: Object.freeze([]), traces: Object.freeze([]), events: Object.freeze([]),
    identityIndex: Object.freeze({ traceIds: Object.freeze([]), omittedTraceIdCount: 0, eventIds: Object.freeze([]), omittedEventIdCount: 0, evidenceIds: Object.freeze([]), omittedEvidenceIdCount: 0 }),
    hasMore: false, omittedEventCount: 0,
  });
  const remaining = Math.max(0, matched - priorMatches - retained.length);
  const lastOrdinal = retained.at(-1)?.collectionOrdinal;
  const hasEventFilter = filters.sourceId !== undefined || filters.actorId !== undefined;
  const traceHeaders = [...scanned.state.headers.values()]
    .filter((header) => (filters.traceId === undefined || header.traceId === filters.traceId) &&
      (!hasEventFilter || matchedTraceIds.has(header.traceId)))
    .map((header) => Object.freeze({
      ...header,
      eventCount: scanned.state.eventCounts.get(header.traceId) ?? 0,
    }));
  return Object.freeze({
    state: scanned.collection.state,
    limitations: scanned.collection.limitations,
    traces: Object.freeze(traceHeaders),
    events: Object.freeze(retained.map(({ event }) => event)),
    identityIndex: Object.freeze({
      traceIds: Object.freeze(scanned.state.traceIdsForIndex),
      omittedTraceIdCount: scanned.state.headers.size - scanned.state.traceIdsForIndex.length,
      eventIds: Object.freeze(scanned.state.eventIdsForIndex),
      omittedEventIdCount: scanned.state.eventIds.size - scanned.state.eventIdsForIndex.length,
      evidenceIds: Object.freeze(scanned.state.evidenceIdsForIndex),
      omittedEvidenceIdCount: scanned.state.evidenceIds.size - scanned.state.evidenceIdsForIndex.length,
    }),
    hasMore: remaining > 0,
    omittedEventCount: remaining,
    ...(remaining > 0 && lastOrdinal !== undefined
      ? { continuation: encodeExecutionTraceContinuation(continuationContext, lastOrdinal) }
      : {}),
  });
}

function range(
  event: ExecutionTraceEventRecord,
  evidence: ExecutionTraceEventRecord["evidence"][number],
  target: EvidenceTarget,
  offset: number,
  limit: number,
): ExecutionEvidenceRange {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > target.bytes.byteLength ||
    !Number.isSafeInteger(limit) || limit < 1 || limit > 256 * 1024) {
    throw new InspectionExecutionTraceError("inspection-request-invalid", "Execution evidence offset or limit is invalid.");
  }
  const bytes = target.bytes.subarray(offset, Math.min(target.bytes.byteLength, offset + limit));
  return Object.freeze({
    evidenceId: evidence.evidenceId,
    eventId: event.eventId,
    traceId: event.traceId,
    key: evidence.key,
    label: evidence.label,
    artifactId: evidence.artifactId,
    pointer: evidence.pointer,
    artifactSha256: evidence.artifactSha256,
    targetSha256: evidence.targetSha256,
    targetByteLength: evidence.targetByteLength,
    offset,
    base64: encodeBase64Bytes(bytes),
    nextOffset: offset + bytes.byteLength < target.bytes.byteLength ? offset + bytes.byteLength : null,
  });
}

export function projectExecutionTraceDetail(
  resolved: ResolvedInspectionAttempt,
  selector: ExecutionTraceDetailSelector,
): ExecutionTraceDetailResult | undefined {
  let selectedEvent: ExecutionTraceEventRecord | undefined;
  let selectedEvidence: ExecutionTraceEventRecord["evidence"][number] | undefined;
  let selectedTarget: EvidenceTarget | undefined;
  const scanned = scanCollection(resolved, (record, _ordinal, state) => {
    if (record.kind !== "event") return;
    if (selector.kind === "execution-event" && record.eventId === selector.eventId) selectedEvent = record;
    if (selector.kind === "execution-evidence") {
      const evidence = record.evidence.find(({ evidenceId }) => evidenceId === selector.evidenceId);
      if (evidence !== undefined) {
        selectedEvent = record;
        selectedEvidence = evidence;
        selectedTarget = verifyEvidence(resolved, state, evidence);
      }
    }
  });
  if (scanned === undefined || selectedEvent === undefined) return undefined;
  if (selector.kind === "execution-evidence") {
    if (selectedEvidence === undefined || selectedTarget === undefined) return undefined;
    return Object.freeze({
      kind: "execution-evidence",
      ...range(selectedEvent, selectedEvidence, selectedTarget, selector.offset ?? 0, selector.limit ?? 64 * 1024),
    });
  }
  const previews = selectedEvent.evidence.map((evidence) => {
    const target = scanned.state.targets.get(`${evidence.artifactId}\u0000${evidence.artifactSha256}\u0000${evidence.pointer}`);
    if (target === undefined) throw integrity("Execution evidence cache is unavailable.");
    const value = range(selectedEvent!, evidence, target, 0, ExecutionTraceRecordLimits.maximumDetailPreviewBytes);
    return Object.freeze({
      evidenceId: value.evidenceId,
      key: value.key,
      label: value.label,
      artifactId: value.artifactId,
      pointer: value.pointer,
      targetSha256: value.targetSha256,
      targetByteLength: value.targetByteLength,
      offset: 0 as const,
      base64: value.base64,
      nextOffset: value.nextOffset,
      truncated: value.nextOffset !== null,
    });
  });
  const result: ExecutionTraceDetailResult = Object.freeze({ kind: "execution-event", event: selectedEvent, evidence: Object.freeze(previews) });
  if (utf8ByteLength(JSON.stringify(result)) > ExecutionTraceRecordLimits.maximumDetailBytes) {
    throw integrity("Execution event detail exceeds its fixed response budget.");
  }
  return result;
}
