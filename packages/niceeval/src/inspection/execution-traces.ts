import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { decodeJsonRecord } from "../shared/json-value.ts";

import type { TraceJson } from "../adapter-execution-trace.ts";
import { executionTraceIndexKeys as indexKeys } from "../record/family/execution-traces/index-definition.ts";
import { executionTracesRecordCollection } from "../record/family/execution-traces/definition.ts";
import {
  ExecutionTraceRecordLimits,
  canonicalTraceJsonChunks,
  displayTextHasForbiddenCharacter,
  parseTraceArtifactJson,
  snapshotTraceJson,
  type ExecutionDisplayBlockRecord,
  type ExecutionTraceEventRecord,
  type ExecutionTraceHeaderRecord,
  type ExecutionTraceScopeRecord,
} from "../record/family/execution-traces/schema.ts";
import type { ResolvedInspectionAttempt } from "./facts.ts";
import {
  readInspectionArtifactSources,
  readInspectionArtifactDescriptors,
  type InspectionArtifactSource,
  type InspectionArtifactDescriptor,
} from "./artifacts.ts";
import {
  decodeBase64UrlUtf8,
  encodeBase64Bytes,
  encodeBase64UrlUtf8,
  InspectionSha256,
  utf8ByteLength,
} from "./bytes.ts";
import type { InspectionFactSource } from "./source.ts";

import {
  InspectionExecutionTraceError,
  integrity,
  openExecutionTraceRecord,
  type ExecutionTraceRecordReader,
} from "./execution-trace-record.ts";
import { HISTORICAL_TRACE_INDEX } from "./execution-trace-keys.ts";

export { InspectionExecutionTraceError } from "./execution-trace-record.ts";
const IDENTITY_INDEX_LIMIT = 256;
const utf8 = new TextEncoder();

export interface ExecutionTraceFilters {
  readonly traceId: string | undefined;
  readonly sourceId: string | undefined;
  readonly actorId: string | undefined;
  readonly eventType: string | undefined;
}

export interface ExecutionTraceOutlineRequest {
  readonly traceId?: string | undefined;
  readonly sourceId?: string | undefined;
  readonly actorId?: string | undefined;
  readonly eventType?: string | undefined;
  readonly fromEventId?: string | undefined;
  readonly continuation?: string | undefined;
}

export type ExecutionTraceDetailSelector =
  | { readonly kind: "execution-event"; readonly eventId: string }
  | {
      readonly kind: "execution-evidence";
      readonly evidenceId: string;
      readonly offset?: number;
      readonly limit?: number;
    };

// Key-enumeration boundary: this outline crosses closeInspectionJson without another projection.
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
  readonly scopeItems?: readonly (ExecutionTraceScopeRecord & { readonly beforeEvent: number })[];
  readonly index?: typeof HISTORICAL_TRACE_INDEX;
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

export interface ExecutionDisplayPreviewText {
  readonly preview: string;
  readonly omittedBytes: number;
}

// Key-enumeration boundary: preview blocks are embedded directly in Inspection JSON.
export type ExecutionDisplayBlockPreview =
  | { readonly kind: "text"; readonly text: ExecutionDisplayPreviewText }
  | {
      readonly kind: "message";
      readonly role: "user" | "assistant" | "system" | "other";
      readonly speaker?: string;
      readonly text: ExecutionDisplayPreviewText;
    }
  | {
      readonly kind: "fields";
      readonly fields: readonly {
        readonly label: string;
        readonly value: ExecutionDisplayPreviewText | number | boolean | null;
      }[];
    }
  | { readonly kind: "code"; readonly language?: string; readonly text: ExecutionDisplayPreviewText }
  | {
      readonly kind: "image";
      readonly artifactId: string;
      readonly alt: string;
      readonly mediaType: string;
      readonly byteLength: number;
      readonly sha256: string;
    };

export type ExecutionDisplayPreview =
  | { readonly state: "absent" }
  | {
      readonly state: "present";
      readonly blocks: readonly ExecutionDisplayBlockPreview[];
      readonly omittedBlockCount?: number;
    };

// Key-enumeration boundary: event outlines are embedded directly in Inspection JSON.
export interface ExecutionTraceEventOutline {
  readonly traceId: string;
  readonly eventId: string;
  readonly origin:
    | { readonly kind: "execution-event"; readonly eventId: string }
    | { readonly kind: "agent-item"; readonly itemId: string };
  readonly ordinal: number;
  readonly type: string;
  readonly source: ExecutionTraceEventRecord["source"];
  readonly actor?: NonNullable<ExecutionTraceEventRecord["actor"]>;
  readonly time?: NonNullable<ExecutionTraceEventRecord["time"]>;
  readonly summary: string;
  readonly omittedSummaryBytes?: number;
  readonly links: ExecutionTraceEventRecord["links"];
  readonly evidence: readonly {
    readonly evidenceId: string;
    readonly key: string;
    readonly label: string;
  }[];
  readonly scopeMemberships: ExecutionTraceEventRecord["scopeMemberships"];
  readonly display: ExecutionDisplayPreview;
}

export type ExecutionTraceDetailResult =
  | {
      readonly kind: "execution-event";
      readonly event: ExecutionTraceEventRecord;
      readonly archive?: ExecutionTraceHeaderRecord["archive"];
      readonly index?: typeof HISTORICAL_TRACE_INDEX;
      readonly evidence: readonly ExecutionEvidencePreview[];
      readonly omittedEvidencePreviewCount?: number;
    }
  | ({
      readonly kind: "execution-evidence";
      readonly archive?: ExecutionTraceHeaderRecord["archive"];
      readonly index?: typeof HISTORICAL_TRACE_INDEX;
    } & ExecutionEvidenceRange);

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

interface EvidenceTarget {
  readonly value: TraceJson;
  readonly byteLength: number;
  readonly targetSha256: string;
}

interface EvidenceReadState {
  artifacts: ReadonlyMap<string, InspectionArtifactSource> | undefined;
  readonly parsedArtifacts: Map<string, unknown>;
  readonly targets: Map<string, EvidenceTarget>;
  descriptors: ReadonlyMap<string, InspectionArtifactDescriptor> | undefined;
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
      if (
        !Number.isSafeInteger(index) ||
        index >= current.length ||
        !Object.prototype.hasOwnProperty.call(current, segment)
      )
        return undefined;
      current = current[index];
    } else if (
      typeof current === "object" &&
      current !== null &&
      Object.prototype.hasOwnProperty.call(current, segment)
    ) {
      const descriptor = Object.getOwnPropertyDescriptor(current, segment);
      if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true) return undefined;
      current = descriptor.value;
    } else return undefined;
  }
  return current;
}

function newEvidenceReadState(): EvidenceReadState {
  return {
    artifacts: undefined,
    parsedArtifacts: new Map(),
    targets: new Map(),
    descriptors: undefined,
  };
}

function readArtifact(
  resolved: ResolvedInspectionAttempt,
  state: EvidenceReadState,
  artifactId: string,
): InspectionArtifactSource {
  if (state.artifacts === undefined) {
    const read = readInspectionArtifactSources(resolved);
    if (Result.isFailure(read)) throw integrity("Execution evidence artifacts are unavailable.");
    state.artifacts = read.success;
  }
  const artifact = state.artifacts.get(artifactId);
  if (artifact === undefined) throw integrity(`Execution evidence artifact ${artifactId} is unavailable.`);
  return artifact;
}

function verifyEvidence(
  resolved: ResolvedInspectionAttempt,
  state: EvidenceReadState,
  evidence: ExecutionTraceEventRecord["evidence"][number],
): EvidenceTarget {
  const artifact = readArtifact(resolved, state, evidence.artifactId);
  if (artifact.sha256 !== evidence.artifactSha256 || artifact.mediaType !== "application/json") {
    throw integrity("Execution evidence artifact digest or media type is invalid.");
  }
  const cacheKey = `${artifact.artifactId}\u0000${artifact.sha256}\u0000${evidence.pointer}`;
  const cached = state.targets.get(cacheKey);
  if (cached !== undefined) {
    if (cached.targetSha256 !== evidence.targetSha256 || cached.byteLength !== evidence.targetByteLength) {
      throw integrity("Execution evidence target digest is invalid.");
    }
    return cached;
  }
  let parsed = state.parsedArtifacts.get(artifact.artifactId);
  if (parsed === undefined) {
    try {
      parsed = parseTraceArtifactJson(artifact.chunks());
    } catch {
      throw integrity(`Execution evidence artifact ${artifact.artifactId} is not verified UTF-8 JSON.`);
    }
    state.parsedArtifacts.set(artifact.artifactId, parsed);
  }
  const target = resolvePointer(parsed, evidence.pointer);
  if (target === undefined) throw integrity("Execution evidence JSON pointer does not resolve.");
  const canonical = snapshotTraceJson(target);
  if (Result.isFailure(canonical)) throw integrity("Execution evidence target is not finite plain JSON.");
  const hash = new InspectionSha256();
  let byteLength = 0;
  for (const chunk of canonicalTraceJsonChunks(canonical.success)) {
    const bytes = utf8.encode(chunk);
    hash.update(bytes);
    byteLength += bytes.byteLength;
  }
  if (hash.digestHex() !== evidence.targetSha256 || byteLength !== evidence.targetByteLength) {
    throw integrity("Execution evidence target digest or length is invalid.");
  }
  const verified = { value: canonical.success, byteLength, targetSha256: evidence.targetSha256 };
  state.targets.set(cacheKey, verified);
  return verified;
}

function displayStrings(block: ExecutionDisplayBlockRecord): readonly string[] {
  switch (block.kind) {
    case "text":
      return [block.text];
    case "message":
      return block.speaker === undefined ? [block.text] : [block.text, block.speaker];
    case "fields":
      return block.fields.flatMap((field) =>
        typeof field.value === "string" ? [field.label, field.value] : [field.label],
      );
    case "code":
      return block.language === undefined ? [block.text] : [block.text, block.language];
    case "image":
      return [block.alt];
  }
}

/** Display blocks are re-validated on read so a hostile or foreign writer cannot bypass acceptance rules. */
function verifyDisplay(
  resolved: ResolvedInspectionAttempt,
  state: EvidenceReadState,
  display: ExecutionTraceEventRecord["display"],
): void {
  if (display === undefined) return;
  for (const block of display) {
    if (displayStrings(block).some(displayTextHasForbiddenCharacter)) {
      throw integrity("Execution display contains a control or bidirectional formatting character.");
    }
    function singleLineLabels(): readonly string[] {
      switch (block.kind) {
        case "fields":
          return block.fields.map((field) => field.label);
        case "message":
          return block.speaker === undefined ? [] : [block.speaker];
        case "code":
          return block.language === undefined ? [] : [block.language];
        case "image":
          return [block.alt];
        default:
          return [];
      }
    }
    const singleLine = singleLineLabels();
    if (singleLine.some((text) => text.includes("\n"))) {
      throw integrity("Execution display label contains a line break.");
    }
    if (block.kind !== "image") continue;
    if (state.descriptors === undefined) {
      const read = readInspectionArtifactDescriptors(resolved);
      if (Result.isFailure(read)) throw integrity("Execution display image artifacts are unreadable.");
      state.descriptors = read.success;
    }
    const descriptor = state.descriptors.get(block.artifactId);
    if (
      descriptor === undefined ||
      descriptor.sha256 !== block.sha256 ||
      descriptor.byteLength !== block.byteLength ||
      descriptor.mediaType !== block.mediaType
    ) {
      throw integrity("Execution display image artifact closure is invalid.");
    }
  }
}

function matches(event: ExecutionTraceEventRecord, filters: ExecutionTraceFilters): boolean {
  return (
    (filters.sourceId === undefined || event.source.id === filters.sourceId) &&
    (filters.actorId === undefined || event.actor?.id === filters.actorId) &&
    (filters.eventType === undefined || event.type === filters.eventType)
  );
}

export const EXECUTION_TRACE_CONTINUATION_FAMILIES = Object.freeze({
  executionTraces: executionTracesRecordCollection.family,
  agentTurns: "niceeval.agent-turns",
});

interface ContinuationBinding {
  readonly operation: "attempt.trace";
  readonly sourceIdentity: InspectionFactSource["kind"];
  readonly cutoff: string;
  readonly originCutoff?: string | undefined;
  readonly originAttempt: string;
  readonly sourceFamily: string;
  readonly familyRevision: number | undefined;
  readonly filters: {
    readonly traceId: string | null;
    readonly sourceId: string | null;
    readonly actorId: string | null;
    readonly eventType: string | null;
  };
  readonly lastOrdinal: number;
  readonly remaining?: number | undefined;
  readonly companion?: string | undefined;
  readonly main?: string | undefined;
  readonly fromEventId?: string | undefined;
}

export interface ExecutionTraceContinuationContext {
  readonly source: InspectionFactSource;
  readonly originCutoff?: string | undefined;
  readonly originAttempt: string;
  readonly sourceFamily: string;
  readonly familyRevision: number | undefined;
  readonly filters: ExecutionTraceFilters;
  readonly companion?: string | undefined;
  readonly main?: string | undefined;
  readonly fromEventId?: string | undefined;
}

function continuationBinding(
  context: ExecutionTraceContinuationContext,
  lastOrdinal: number,
  remaining?: number,
): ContinuationBinding {
  return {
    operation: "attempt.trace",
    sourceIdentity: context.source.kind,
    cutoff: context.source.cutoff().identity,
    originCutoff: context.originCutoff,
    originAttempt: context.originAttempt,
    sourceFamily: context.sourceFamily,
    familyRevision: context.familyRevision,

    filters: {
      traceId: context.filters.traceId ?? null,
      sourceId: context.filters.sourceId ?? null,
      actorId: context.filters.actorId ?? null,
      eventType: context.filters.eventType ?? null,
    },
    lastOrdinal,
    remaining,
    companion: context.companion,
    main: context.main,
    fromEventId: context.fromEventId,
  };
}

export function encodeExecutionTraceContinuation(
  context: ExecutionTraceContinuationContext,
  lastOrdinal: number,
  remaining?: number,
): string {
  if (!Number.isSafeInteger(lastOrdinal) || lastOrdinal < 0) {
    throw new InspectionExecutionTraceError(
      "restart-required",
      "Execution trace continuation binding changed; restart from the first page.",
    );
  }
  return encodeBase64UrlUtf8(JSON.stringify(continuationBinding(context, lastOrdinal, remaining)));
}

export function decodeExecutionTraceContinuation(token: string, context: ExecutionTraceContinuationContext): number {
  return readTraceContinuation(token, context).lastOrdinal;
}

function readTraceContinuation(token: string, context: ExecutionTraceContinuationContext) {
  try {
    const parsed = decodeJsonRecord(decodeBase64UrlUtf8(token));
    const lastOrdinal = Schema.decodeUnknownSync(Schema.Number)(parsed.lastOrdinal);
    const remaining = Schema.decodeUnknownSync(Schema.UndefinedOr(Schema.Number))(parsed.remaining);
    const expected = continuationBinding(context, lastOrdinal, remaining);
    if (!Number.isSafeInteger(lastOrdinal) || lastOrdinal < 0 || JSON.stringify(parsed) !== JSON.stringify(expected)) {
      throw new Error("binding changed");
    }
    if (remaining !== undefined && (!Number.isSafeInteger(remaining) || remaining < 0))
      throw new Error("binding changed");
    return { lastOrdinal, remaining };
  } catch {
    throw new InspectionExecutionTraceError(
      "restart-required",
      "Execution trace continuation binding changed; restart from the first page.",
    );
  }
}

function continuationSourceFamily(token: string): string | undefined {
  try {
    const parsed = decodeJsonRecord(decodeBase64UrlUtf8(token));
    return Schema.decodeUnknownSync(Schema.String)(parsed.sourceFamily);
  } catch {
    return undefined;
  }
}

/** UTF-8-safe prefix: never splits a code point; omitted bytes count the remainder. */
function previewText(value: string, limit: number): ExecutionDisplayPreviewText {
  let total = 0;
  let retained = 0;
  let end = 0;
  for (const character of value) {
    const point = character.codePointAt(0)!;
    total += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
    if (total <= limit) {
      retained = total;
      end += character.length;
    }
  }
  return { preview: value.slice(0, end), omittedBytes: total - retained };
}

function previewBlock(block: ExecutionDisplayBlockRecord, limit: number): ExecutionDisplayBlockPreview {
  switch (block.kind) {
    case "text":
      return { kind: "text", text: previewText(block.text, limit) };
    case "message":
      return {
        kind: "message",
        role: block.role,
        ...(block.speaker === undefined ? {} : { speaker: block.speaker }),
        text: previewText(block.text, limit),
      };
    case "fields":
      return {
        kind: "fields",
        fields: block.fields.map((field) => ({
          label: field.label,
          value: typeof field.value === "string" ? previewText(field.value, limit) : field.value,
        })),
      };
    case "code":
      return {
        kind: "code",
        ...(block.language === undefined ? {} : { language: block.language }),
        text: previewText(block.text, limit),
      };
    case "image":
      return block;
  }
}

function previewDisplay(display: ExecutionTraceEventRecord["display"], budget: number): ExecutionDisplayPreview {
  if (display === undefined) return { state: "absent" };
  const blocks: ExecutionDisplayBlockPreview[] = [];
  let remaining = budget;
  for (const block of display) {
    if (remaining <= 0 || (block.kind === "fields" && block.fields.length > remaining)) break;
    let limit: number = ExecutionTraceRecordLimits.maximumDisplayPreviewBytes;
    let preview = previewBlock(block, limit);
    let size = utf8ByteLength(JSON.stringify(preview)) + 1;
    while (size > remaining && limit > 0) {
      limit = Math.floor(limit / 2);
      preview = previewBlock(block, limit);
      size = utf8ByteLength(JSON.stringify(preview)) + 1;
    }
    if (size > remaining) break;
    blocks.push(preview);
    remaining -= size;
  }
  const omittedBlockCount = display.length - blocks.length;
  return { state: "present", blocks, ...(omittedBlockCount === 0 ? {} : { omittedBlockCount }) };
}

function outlineEvent(event: ExecutionTraceEventRecord): ExecutionTraceEventOutline {
  const summary = previewText(event.summary, ExecutionTraceRecordLimits.maximumDisplayPreviewBytes);
  const envelope = {
    traceId: event.traceId,
    eventId: event.eventId,
    origin: { kind: "execution-event" as const, eventId: event.eventId },
    ordinal: event.ordinal,
    type: event.type,
    source: event.source,
    ...(event.actor === undefined ? {} : { actor: event.actor }),
    ...(event.time === undefined ? {} : { time: event.time }),
    summary: summary.preview,
    ...(summary.omittedBytes === 0 ? {} : { omittedSummaryBytes: summary.omittedBytes }),
    links: event.links,
    evidence: event.evidence.map(({ evidenceId, key, label }) => ({ evidenceId, key, label })),
    scopeMemberships: event.scopeMemberships,
  };
  const emptyDisplay =
    event.display === undefined
      ? { state: "absent" }
      : { state: "present", blocks: [], omittedBlockCount: event.display.length };
  const envelopeBytes = utf8ByteLength(JSON.stringify({ ...envelope, display: emptyDisplay }));
  const display = previewDisplay(event.display, ExecutionTraceRecordLimits.maximumOutlineEventBytes - envelopeBytes);
  return { ...envelope, display };
}

const emptyIdentities: ExecutionTraceOutlineResult["identityIndex"] = {
  traceIds: [],
  omittedTraceIdCount: 0,
  eventIds: [],
  omittedEventIdCount: 0,
  evidenceIds: [],
  omittedEvidenceIdCount: 0,
};

interface IndexedTraceHeader {
  readonly header: ExecutionTraceHeaderRecord;
  readonly recordOrdinal: number;
  readonly eventCount: number;
  readonly scopeCount: number;
}

type SelectedTraceIndex = NonNullable<ExecutionTraceRecordReader["index"]>;

function indexedHeader(
  reader: ExecutionTraceRecordReader,
  entry: { readonly recordOrdinal: number; readonly traceId: string; readonly sourceTraceId: string },
): ExecutionTraceHeaderRecord {
  const record = reader.read(entry.recordOrdinal);
  if (
    record.kind !== "trace-header" ||
    record.traceId !== entry.traceId ||
    record.sourceTraceId !== entry.sourceTraceId
  )
    throw integrity("Execution trace index does not address its header.");
  return record;
}

function indexedHeaders(reader: ExecutionTraceRecordReader, index: SelectedTraceIndex, traceId: string | undefined) {
  const traces: IndexedTraceHeader[] = [];
  const traceIds: string[] = [];
  const eventIds: string[] = [];
  const evidenceIds: string[] = [];
  let allEvents = 0;
  let allEvidence = 0;
  const selected = traceId === undefined ? undefined : index.findTrace(traceId);
  const entries =
    traceId === undefined
      ? Array.from(index.prefix("0/"), ({ entry }) => entry).sort(
          (left, right) => left.recordOrdinal - right.recordOrdinal,
        )
      : selected === undefined
        ? []
        : [selected];

  for (const { value, recordOrdinal } of entries) {
    if (value.kind !== "trace") throw integrity("Execution trace header index entry is invalid.");
    const header = indexedHeader(reader, { ...value, recordOrdinal });
    if (traceIds.length < IDENTITY_INDEX_LIMIT) traceIds.push(value.traceId);
    let eventCount = 0;
    let evidenceCount = 0;
    if (
      header.eventCount === undefined ||
      header.evidenceCount === undefined ||
      (header.eventCount > 0 && eventIds.length < IDENTITY_INDEX_LIMIT)
    ) {
      // Older array headers have no counts. Their mapping provides exact counts without reading payloads.
      let sampled = 0;
      for (const { entry } of index.prefix(indexKeys.ordered(value.sourceTraceId))) {
        if (entry.value.kind === "event") {
          eventCount += 1;
          if (eventIds.length < IDENTITY_INDEX_LIMIT) eventIds.push(entry.value.eventId);
        } else if (entry.value.kind === "evidence") {
          evidenceCount += 1;
          if (evidenceIds.length < IDENTITY_INDEX_LIMIT) evidenceIds.push(entry.value.evidenceId);
        }
        sampled += 1;
        if (header.eventCount !== undefined && header.evidenceCount !== undefined && sampled === IDENTITY_INDEX_LIMIT)
          break;
      }
    }
    eventCount = header.eventCount ?? eventCount;
    evidenceCount = header.evidenceCount ?? evidenceCount;
    allEvents += eventCount;
    allEvidence += evidenceCount;
    traces.push({ header, recordOrdinal, eventCount, scopeCount: header.scopeCount ?? 0 });
  }
  return {
    traces,
    allEvents,
    identities: {
      traceIds,
      eventIds,
      evidenceIds,
      omittedTraceIdCount: traces.length - traceIds.length,
      omittedEventIdCount: allEvents - eventIds.length,
      omittedEvidenceIdCount: allEvidence - evidenceIds.length,
    },
  };
}

function missingStart() {
  return new InspectionExecutionTraceError(
    "inspection-selection-missing",
    "Starting event does not belong to the selected trace and filters.",
  );
}

function exactEvent(
  reader: ExecutionTraceRecordReader,
  entry: {
    readonly recordOrdinal: number;
    readonly eventId: string;
    readonly traceId: string;
    readonly ordinal: number;
  },
) {
  const record = reader.read(entry.recordOrdinal);
  if (
    record.kind !== "event" ||
    record.eventId !== entry.eventId ||
    record.traceId !== entry.traceId ||
    record.ordinal !== entry.ordinal
  )
    throw integrity("Execution trace index does not address its event.");
  return record;
}

function outlinePage(resolved: ResolvedInspectionAttempt) {
  const events: ExecutionTraceEventOutline[] = [];
  const scopeItems: NonNullable<ExecutionTraceOutlineResult["scopeItems"]>[number][] = [];
  const state = newEvidenceReadState();
  let bytes = 2;
  let lastOrdinal = -1;
  let hasMore = false;
  return {
    events,
    scopeItems,
    get lastOrdinal() {
      return lastOrdinal;
    },
    get hasMore() {
      return hasMore;
    },
    add(record: ExecutionTraceEventRecord | ExecutionTraceScopeRecord, ordinal: number) {
      if (hasMore) return;
      const length = events.length + scopeItems.length;
      if (length === ExecutionTraceRecordLimits.maximumOutlineEvents) {
        hasMore = true;
        return;
      }
      const projected =
        record.kind === "scope"
          ? ({ kind: "scope", value: { ...record, beforeEvent: events.length } } as const)
          : ({ kind: "event", value: outlineEvent(record) } as const);
      const size = utf8ByteLength(JSON.stringify(projected.value)) + (length > 0 ? 1 : 0);
      if (length > 0 && bytes + size > ExecutionTraceRecordLimits.maximumOutlineBytes) {
        hasMore = true;
        return;
      }
      bytes += size;
      lastOrdinal = ordinal;
      if (projected.kind === "scope") scopeItems.push(projected.value);
      else {
        if (record.kind === "event") verifyDisplay(resolved, state, record.display);
        events.push(projected.value);
      }
    },
  };
}

function publishedOutline(
  reader: ExecutionTraceRecordReader,
  index: SelectedTraceIndex,
  resolved: ResolvedInspectionAttempt,
  filters: ExecutionTraceFilters,
  fromEventId: string | undefined,
  resume: ReturnType<typeof readTraceContinuation> | undefined,
) {
  const { traces, allEvents, identities } = indexedHeaders(reader, index, filters.traceId);
  const page = outlinePage(resolved);
  let start = 0;
  let firstOrdinal = 0;
  if (fromEventId !== undefined) {
    const entry = index.find(indexKeys.eventId(fromEventId));
    if (entry?.value.kind !== "event" || entry.value.traceId !== traces[0]?.header.traceId) throw missingStart();
    start = entry.recordOrdinal;
    firstOrdinal = entry.value.ordinal;
    if (resume !== undefined && start > resume.lastOrdinal)
      throw new InspectionExecutionTraceError(
        "restart-required",
        "Execution trace continuation precedes its starting event.",
      );
  }

  const filtered = filters.sourceId !== undefined || filters.actorId !== undefined || filters.eventType !== undefined;
  let matchingEvents = 0;
  for (const trace of traces) {
    const end = trace.recordOrdinal + 1 + trace.eventCount + trace.scopeCount;
    const first = Math.max(start, trace.recordOrdinal + 1, (resume?.lastOrdinal ?? -1) + 1);
    for (const { record, recordOrdinal } of reader.readRange(first, end)) {
      if (record.traceId !== trace.header.traceId || record.kind === "trace-header")
        throw integrity("Execution trace item lies outside its indexed header.");
      if (recordOrdinal === start && fromEventId !== undefined) {
        if (record.kind !== "event" || record.eventId !== fromEventId || record.ordinal !== firstOrdinal)
          throw integrity("Execution trace index does not address the starting event.");
        if (!matches(record, filters)) throw missingStart();
      }
      if (record.kind === "event" && !matches(record, filters)) continue;
      if (record.kind === "event") matchingEvents += 1;
      page.add(record, recordOrdinal);
      if (page.hasMore && !filtered) break;
    }
    if (page.hasMore && !filtered) break;
  }
  const remaining = (filtered ? matchingEvents : (resume?.remaining ?? allEvents - firstOrdinal)) - page.events.length;
  return { page, remaining, identities, headers: traces.map(({ header, eventCount }) => ({ ...header, eventCount })) };
}

function historicalOutline(
  reader: ExecutionTraceRecordReader,
  resolved: ResolvedInspectionAttempt,
  filters: ExecutionTraceFilters,
  fromEventId: string | undefined,
  resumeAfter: number,
) {
  const traces = new Map<string, ExecutionTraceHeaderRecord & { eventCount: number }>();
  const traceIds: string[] = [];
  const eventIds: string[] = [];
  const evidenceIds: string[] = [];
  let allEvents = 0;
  let allEvidence = 0;
  let matchingEvents = 0;
  let started = fromEventId === undefined;
  let selectedTrace = false;
  let header: (ExecutionTraceHeaderRecord & { eventCount: number }) | undefined;
  const page = outlinePage(resolved);
  for (const { record, recordOrdinal } of reader.readRange()) {
    if (record.kind === "trace-header") {
      header = { ...record, eventCount: 0 };
      if (traces.has(record.traceId)) throw integrity("Execution trace identities are duplicated.");
      traces.set(record.traceId, header);
      if (traceIds.length < IDENTITY_INDEX_LIMIT) traceIds.push(record.traceId);
      selectedTrace =
        filters.traceId === undefined || filters.traceId === record.traceId || filters.traceId === record.sourceTraceId;
      continue;
    }
    if (
      header === undefined ||
      header.traceId !== record.traceId ||
      record.kind !== "event" ||
      record.ordinal !== header.eventCount
    )
      throw integrity("Historical execution trace sequence is invalid.");
    header.eventCount += 1;
    allEvents += 1;
    allEvidence += record.evidence.length;
    if (eventIds.length < IDENTITY_INDEX_LIMIT) eventIds.push(record.eventId);
    for (const evidence of record.evidence) {
      if (evidenceIds.length === IDENTITY_INDEX_LIMIT) break;
      evidenceIds.push(evidence.evidenceId);
    }
    if (!selectedTrace || !matches(record, filters)) continue;
    if (record.eventId === fromEventId) started = true;
    if (!started || recordOrdinal <= resumeAfter) continue;
    matchingEvents += 1;
    page.add(record, recordOrdinal);
  }
  if (!started) throw missingStart();
  return {
    page,
    remaining: matchingEvents - page.events.length,
    identities: {
      traceIds,
      eventIds,
      evidenceIds,
      omittedTraceIdCount: traces.size - traceIds.length,
      omittedEventIdCount: allEvents - eventIds.length,
      omittedEvidenceIdCount: allEvidence - evidenceIds.length,
    },
    headers: [...traces.values()].filter(
      (trace) =>
        filters.traceId === undefined || trace.traceId === filters.traceId || trace.sourceTraceId === filters.traceId,
    ),
  };
}

// @concord-code
// @concord-implements docs/feature/adapters/use-case/long-trace-stream.md#outline
// @concord-implements docs/feature/adapters/use-case/long-trace-stream.md#jump
// @concord-implements docs/feature/adapters/use-case/long-trace-stream.md#continue
export function projectExecutionTraceOutline(
  source: InspectionFactSource,
  resolved: ResolvedInspectionAttempt,
  request: ExecutionTraceOutlineRequest,
): ExecutionTraceOutlineResult {
  const filters: ExecutionTraceFilters = {
    traceId: request.traceId,
    sourceId: request.sourceId,
    actorId: request.actorId,
    eventType: request.eventType,
  };
  const reader = openExecutionTraceRecord(resolved);
  const context: ExecutionTraceContinuationContext = {
    source,
    filters,
    originAttempt: `${resolved.attempt.originRunId}:${resolved.attempt.attemptId}`,
    originCutoff: resolved.origin.source.cutoff().identity,
    sourceFamily: EXECUTION_TRACE_CONTINUATION_FAMILIES.executionTraces,
    familyRevision: undefined,
    ...(reader === undefined ? {} : { main: reader.identity }),
    ...(reader?.index === undefined ? {} : { companion: reader.index.identity }),
    ...(request.fromEventId === undefined ? {} : { fromEventId: request.fromEventId }),
  };
  if (request.fromEventId !== undefined && request.traceId === undefined && request.continuation === undefined)
    throw missingStart();
  const resume =
    request.continuation === undefined ||
    (reader === undefined &&
      request.fromEventId === undefined &&
      continuationSourceFamily(request.continuation) === EXECUTION_TRACE_CONTINUATION_FAMILIES.agentTurns)
      ? undefined
      : readTraceContinuation(request.continuation, context);
  if (reader === undefined) {
    if (request.fromEventId !== undefined) throw missingStart();
    return {
      state: "not-recorded",
      limitations: [],
      traces: [],
      events: [],
      identityIndex: emptyIdentities,
      hasMore: false,
      omittedEventCount: 0,
    };
  }
  if (resume !== undefined && resume.lastOrdinal >= reader.count)
    throw new InspectionExecutionTraceError(
      "restart-required",
      "Execution trace continuation position is outside its collection.",
    );
  const { page, remaining, identities, headers } =
    reader.index === undefined
      ? historicalOutline(reader, resolved, filters, request.fromEventId, resume?.lastOrdinal ?? -1)
      : publishedOutline(reader, reader.index, resolved, filters, request.fromEventId, resume);
  return {
    state: reader.collection.state,
    limitations: reader.collection.limitations,
    traces: headers,
    events: page.events,
    ...(page.scopeItems.length === 0 ? {} : { scopeItems: page.scopeItems }),
    ...(reader.index === undefined ? { index: HISTORICAL_TRACE_INDEX } : {}),
    identityIndex: identities,
    hasMore: page.hasMore,
    omittedEventCount: remaining,
    ...(page.hasMore ? { continuation: encodeExecutionTraceContinuation(context, page.lastOrdinal, remaining) } : {}),
  };
}

function range(
  event: ExecutionTraceEventRecord,
  evidence: ExecutionTraceEventRecord["evidence"][number],
  target: EvidenceTarget,
  offset: number,
  limit: number,
): ExecutionEvidenceRange {
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset > target.byteLength ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 256 * 1024
  ) {
    throw new InspectionExecutionTraceError(
      "inspection-request-invalid",
      "Execution evidence offset or limit is invalid.",
    );
  }
  const bytes = new Uint8Array(Math.min(limit, target.byteLength - offset));
  let position = 0;
  for (const chunk of canonicalTraceJsonChunks(target.value)) {
    if (position >= offset + bytes.byteLength) break;
    const encoded = utf8.encode(chunk);
    const start = Math.max(offset, position);
    const end = Math.min(offset + bytes.byteLength, position + encoded.byteLength);
    if (end > start) bytes.set(encoded.subarray(start - position, end - position), start - offset);
    position += encoded.byteLength;
  }
  return {
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
    nextOffset: offset + bytes.byteLength < target.byteLength ? offset + bytes.byteLength : null,
  };
}

export function projectExecutionTraceDetail(
  resolved: ResolvedInspectionAttempt,
  selector: ExecutionTraceDetailSelector,
): ExecutionTraceDetailResult | undefined {
  const reader = openExecutionTraceRecord(resolved);
  if (reader === undefined) return undefined;
  let selectedEvent: ExecutionTraceEventRecord | undefined;
  let selectedEvidence: ExecutionTraceEventRecord["evidence"][number] | undefined;
  let header: ExecutionTraceHeaderRecord | undefined;
  if (reader.index !== undefined) {
    const entry = reader.index.find(
      selector.kind === "execution-event"
        ? indexKeys.eventId(selector.eventId)
        : indexKeys.evidenceId(selector.evidenceId),
    );
    if (entry === undefined) return undefined;
    if (entry.value.kind !== "event" && entry.value.kind !== "evidence")
      throw integrity("Execution trace detail index entry is invalid.");
    selectedEvent = exactEvent(reader, { ...entry.value, recordOrdinal: entry.recordOrdinal });
    const trace = reader.index.find(indexKeys.trace(entry.value.sourceTraceId));
    if (trace?.value.kind !== "trace" || trace.value.traceId !== selectedEvent.traceId)
      throw integrity("Execution trace detail index does not address its header.");
    header = indexedHeader(reader, { ...trace.value, recordOrdinal: trace.recordOrdinal });
    if (selector.kind === "execution-evidence") {
      if (entry.value.kind !== "evidence") throw integrity("Execution evidence index entry is invalid.");
      selectedEvidence = selectedEvent.evidence[entry.value.evidenceOrdinal];
      if (selectedEvidence?.evidenceId !== selector.evidenceId)
        throw integrity("Execution evidence index does not address its evidence.");
    }
  } else {
    for (const { record } of reader.readRange()) {
      if (record.kind === "trace-header") {
        header = record;
        continue;
      }
      if (record.kind !== "event") continue;
      if (selector.kind === "execution-event" && record.eventId !== selector.eventId) continue;
      if (selector.kind === "execution-evidence") {
        selectedEvidence = record.evidence.find(({ evidenceId }) => evidenceId === selector.evidenceId);
        if (selectedEvidence === undefined) continue;
      }
      selectedEvent = record;
      break;
    }
  }
  if (selectedEvent === undefined) return undefined;
  if (header?.traceId !== selectedEvent.traceId) throw integrity("Execution trace event has no header.");
  const provenance = {
    ...(header.archive === undefined ? {} : { archive: header.archive }),
    ...(reader.index === undefined ? { index: HISTORICAL_TRACE_INDEX } : {}),
  };
  const state = newEvidenceReadState();
  if (selector.kind === "execution-evidence") {
    if (selectedEvidence === undefined) return undefined;
    const target = verifyEvidence(resolved, state, selectedEvidence);
    return {
      kind: "execution-evidence",
      ...provenance,
      ...range(selectedEvent, selectedEvidence, target, selector.offset ?? 0, selector.limit ?? 64 * 1024),
    };
  }
  verifyDisplay(resolved, state, selectedEvent.display);
  const previews: ExecutionEvidencePreview[] = [];
  let remaining = ExecutionTraceRecordLimits.maximumDetailBytes;
  for (const evidence of selectedEvent.evidence) {
    const target = verifyEvidence(resolved, state, evidence);
    const value = range(selectedEvent, evidence, target, 0, ExecutionTraceRecordLimits.maximumDetailPreviewBytes);
    const preview: ExecutionEvidencePreview = {
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
    };
    const size = utf8ByteLength(JSON.stringify(preview)) + 1;
    if (size > remaining) break;
    remaining -= size;
    previews.push(preview);
  }
  const omittedEvidencePreviewCount = selectedEvent.evidence.length - previews.length;
  return {
    kind: "execution-event",
    event: selectedEvent,
    ...provenance,
    evidence: previews,
    ...(omittedEvidencePreviewCount === 0 ? {} : { omittedEvidencePreviewCount }),
  };
}
