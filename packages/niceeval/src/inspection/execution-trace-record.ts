import * as Data from "effect/Data";
import * as Schema from "effect/Schema";
import * as Result from "effect/Result";
import { executionTracesRecordCollection } from "../record/family/execution-traces/definition.ts";
import {
  EXECUTION_TRACE_INDEX_PAGE_ENTRIES,
  ExecutionTraceIndexRecordSchema,
  executionTraceIndexKeys,
  executionTraceIndexRecordCollection,
  type ExecutionTraceIndexRecord,
} from "../record/family/execution-traces/index-definition.ts";
import { ExecutionTraceStoredRecordSchema } from "../record/family/execution-traces/schema.ts";
import type { AttemptRecordCollectionLimitation } from "../record/authoring.ts";
import { InspectionSha256 } from "./bytes.ts";
import type { DecodedInspectionAttachment, ResolvedInspectionAttempt } from "./facts.ts";
import type { InspectionFactSource } from "./source.ts";

const utf8 = new TextEncoder();
const PAGE_ROWS = 64;

export class InspectionExecutionTraceError extends Data.TaggedError("InspectionExecutionTraceError")<{}> {
  readonly code:
    | "inspection-request-invalid"
    | "inspection-selection-missing"
    | "inspection-record-integrity-failure"
    | "restart-required";
  constructor(code: InspectionExecutionTraceError["code"], message: string) {
    super();
    this.message = message;
    this.name = "InspectionExecutionTraceError";
    this.code = code;
  }
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
  return inspectionTupleDigest("niceeval.record.collection-item-logical-identity", [ordinal, canonicalDigest]);
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

export function integrity(message: string): InspectionExecutionTraceError {
  return new InspectionExecutionTraceError("inspection-record-integrity-failure", message);
}

function collectionAttachment(
  resolved: ResolvedInspectionAttempt,
  family: string,
): DecodedInspectionAttachment | undefined {
  const matches = resolved.origin.attachments.filter(
    ({ physical }) =>
      physical.ownerKind === "attempt" &&
      physical.ownerAttemptId === resolved.attempt.attemptId &&
      physical.family === family,
  );
  if (matches.length > 1) throw integrity("Execution trace owner has duplicate collection attachments.");
  return matches[0];
}

function validateAttachment(
  resolved: ResolvedInspectionAttempt,
  attachment: DecodedInspectionAttachment,
  definition: typeof executionTracesRecordCollection | typeof executionTraceIndexRecordCollection,
): {
  readonly collection: {
    readonly state: "complete" | "partial";
    readonly limitations: readonly AttemptRecordCollectionLimitation[];
  };
  readonly expectedDigest: string;
} {
  const physical = attachment.physical;
  if (
    physical.ownerKind !== "attempt" ||
    physical.ownerAttemptId !== resolved.attempt.attemptId ||
    physical.ownerRunId !== resolved.attempt.originRunId ||
    physical.family !== definition.family ||
    physical.familyRevision !== undefined ||
    physical.references.length !== 0 ||
    physical.contents.length !== 0 ||
    digest(physical.canonicalBytes) !== physical.canonicalDigest ||
    digest(physical.logicalInventoryBytes) !== physical.inventoryDigest ||
    physical.logicalIdentity !==
      inspectionTupleDigest("niceeval.record.attachment-logical-identity", [
        physical.attachmentId,
        physical.canonicalDigest,
        physical.inventoryDigest,
      ])
  ) {
    throw integrity("Execution trace collection attachment closure is invalid.");
  }
  const shell =
    definition.family === executionTracesRecordCollection.family
      ? Schema.decodeUnknownResult(executionTracesRecordCollection.schema, { onExcessProperty: "error" })(
          attachment.value,
        )
      : Schema.decodeUnknownResult(executionTraceIndexRecordCollection.schema, { onExcessProperty: "error" })(
          attachment.value,
        );
  if (shell._tag === "Failure" || shell.success.items.length !== 0)
    throw integrity("Execution trace collection shell is invalid.");
  const inventory = decodeInventory(parseJson(physical.logicalInventoryBytes, "Execution trace collection inventory"));
  if (
    inventory._tag === "Failure" ||
    inventory.success.collection.count !== physical.collectionItemCount ||
    inventory.success.collection.byteLength !== physical.collectionItemByteLength
  )
    throw integrity("Execution trace collection inventory is invalid.");
  return {
    collection: shell.success.collection,
    expectedDigest: inventory.success.collection.digest,
  };
}

const decodeInventory = Schema.decodeUnknownResult(
  Schema.Struct({
    collection: Schema.Struct({ count: Schema.Number, byteLength: Schema.Number, digest: Schema.String }),
  }),
);

type TraceCollectionDefinition = typeof executionTracesRecordCollection | typeof executionTraceIndexRecordCollection;

class TraceCollection {
  readonly count: number;
  readonly identity: string;
  readonly collection: ReturnType<typeof validateAttachment>["collection"];
  private readonly expectedDigest: string;
  private readonly attachmentId: string;
  private readonly source: InspectionFactSource;
  private readonly byteLength: number;

  constructor(
    source: InspectionFactSource,
    resolved: ResolvedInspectionAttempt,
    attachment: DecodedInspectionAttachment,
    definition: TraceCollectionDefinition,
  ) {
    const { collection, expectedDigest } = validateAttachment(resolved, attachment, definition);
    this.source = source;
    this.count = attachment.physical.collectionItemCount;
    this.byteLength = attachment.physical.collectionItemByteLength;
    this.identity = attachment.physical.logicalIdentity;
    this.attachmentId = attachment.physical.attachmentId;
    this.collection = collection;
    this.expectedDigest = expectedDigest;
  }

  *items(start: number, end: number, verifyAggregate = false) {
    const hash = verifyAggregate ? new InspectionSha256() : undefined;
    let ordinal = start;
    let byteLength = 0;
    while (ordinal < end) {
      const limit = Math.min(PAGE_ROWS, end - ordinal);
      const page = this.readPage(ordinal, limit);
      for (const item of page.items) {
        hash?.update(item.canonicalBytes).update(Uint8Array.of(0x0a));
        byteLength += item.canonicalBytes.byteLength;
        yield item;
        ordinal += 1;
      }
    }
    if (hash !== undefined && (hash.digestHex() !== this.expectedDigest || byteLength !== this.byteLength))
      throw integrity("Execution trace collection aggregate closure is invalid.");
  }

  item(ordinal: number) {
    if (ordinal < 0 || ordinal >= this.count) throw integrity("Execution trace record ordinal is out of range.");
    const item = this.readPage(ordinal, 1).items[0];
    if (item === undefined) throw integrity("Execution trace record ordinal is missing.");
    return item;
  }

  private readPage(ordinal: number, limit: number) {
    const after = ordinal - 1;
    const page = this.source.readCollectionPage(this.attachmentId, after, limit);
    const end = ordinal + page.items.length;
    if (
      page.attachmentId !== this.attachmentId ||
      page.afterOrdinal !== after ||
      page.items.length === 0 ||
      page.items.length > limit ||
      end > this.count ||
      page.nextOrdinal !== (end === this.count ? null : end - 1)
    )
      throw integrity("Execution trace collection page is invalid.");
    for (const [offset, item] of page.items.entries()) {
      const expectedOrdinal = ordinal + offset;
      const itemDigest = digest(item.canonicalBytes);
      if (
        item.ordinal !== expectedOrdinal ||
        item.canonicalDigest !== itemDigest ||
        item.logicalIdentity !== executionCollectionItemLogicalIdentity(expectedOrdinal, itemDigest)
      )
        throw integrity("Execution trace collection item closure is invalid.");
    }
    return page;
  }
}

export function openExecutionTraceRecord(resolved: ResolvedInspectionAttempt) {
  const mainAttachment = collectionAttachment(resolved, executionTracesRecordCollection.family);
  const indexAttachment = collectionAttachment(resolved, executionTraceIndexRecordCollection.family);
  if (mainAttachment === undefined) {
    if (indexAttachment !== undefined) throw integrity("Execution trace index has no main collection.");
    return undefined;
  }
  const { source } = resolved.origin;
  const main = new TraceCollection(source, resolved, mainAttachment, executionTracesRecordCollection);
  const index =
    indexAttachment === undefined
      ? undefined
      : new ExecutionTraceIndexReader(
          new TraceCollection(source, resolved, indexAttachment, executionTraceIndexRecordCollection),
        );

  function decode(item: ReturnType<TraceCollection["item"]>) {
    const parsed = decodeRecord(parseJson(item.canonicalBytes, "Execution trace collection item"));
    if (Result.isFailure(parsed)) throw integrity("Execution trace collection item schema is invalid.");
    if (parsed.success.kind === "trace-header" && (parsed.success.index === "published") !== (index !== undefined))
      throw integrity("Execution trace index declaration does not match its collection.");
    return parsed.success;
  }

  return {
    index,
    count: main.count,
    identity: main.identity,
    collection: main.collection,
    read: (ordinal: number) => decode(main.item(ordinal)),
    *readRange(start = 0, end = main.count) {
      for (const item of main.items(start, end, index === undefined && start === 0 && end === main.count)) {
        yield { record: decode(item), recordOrdinal: item.ordinal };
      }
    },
  };
}

const decodeRecord = Schema.decodeUnknownResult(ExecutionTraceStoredRecordSchema, { onExcessProperty: "error" });
const decodeIndex = Schema.decodeUnknownResult(ExecutionTraceIndexRecordSchema, { onExcessProperty: "error" });

export interface ExecutionTraceIndexPosition {
  readonly page: number;
  readonly offset: number;
}

class ExecutionTraceIndexReader {
  private readonly cache = new Map<number, ExecutionTraceIndexRecord["entries"]>();

  private readonly storage: TraceCollection;

  constructor(storage: TraceCollection) {
    this.storage = storage;
  }

  get identity() {
    return this.storage.identity;
  }

  private read(page: number) {
    const cached = this.cache.get(page);
    if (cached !== undefined) return cached;
    const item = this.storage.item(page);
    const decoded = decodeIndex(parseJson(item.canonicalBytes, "Execution trace index page"));
    if (Result.isFailure(decoded)) throw integrity("Execution trace index page schema is invalid.");
    const { entries } = decoded.success;
    if (entries.length > EXECUTION_TRACE_INDEX_PAGE_ENTRIES)
      throw integrity("Execution trace index page is too large.");
    let previous: string | undefined;
    for (const { searchKey } of entries) {
      if (previous !== undefined && searchKey <= previous) throw integrity("Execution trace index page is unsorted.");
      previous = searchKey;
    }
    if (this.cache.size >= 8) {
      const oldest = this.cache.keys().next();
      if (!oldest.done) this.cache.delete(oldest.value);
    }
    this.cache.set(page, entries);
    return entries;
  }

  private seek(key: string): ExecutionTraceIndexPosition {
    let start = 0;
    let end = this.storage.count;
    while (start < end) {
      const middle = start + Math.floor((end - start) / 2);
      const entries = this.read(middle);
      const last = entries.at(-1);
      if (last !== undefined && last.searchKey < key) start = middle + 1;
      else end = middle;
    }
    if (start === this.storage.count) return { page: start, offset: 0 };
    const offset = this.read(start).findIndex(({ searchKey }) => searchKey >= key);
    return { page: start, offset };
  }

  find(key: string) {
    const { page, offset } = this.seek(key);
    if (page === this.storage.count) return undefined;
    const entry = this.read(page)[offset];
    return entry?.searchKey === key ? entry : undefined;
  }

  findTrace(traceId: string) {
    const source = this.find(executionTraceIndexKeys.trace(traceId));
    if (source?.value.kind === "trace" && source.value.sourceTraceId === traceId) return source;
    const persisted = this.find(executionTraceIndexKeys.traceId(traceId));
    return persisted?.value.kind === "trace" && persisted.value.traceId === traceId ? persisted : undefined;
  }

  *prefix(prefix: string, resume?: ExecutionTraceIndexPosition) {
    if (
      resume !== undefined &&
      (resume.page >= this.storage.count || !this.read(resume.page)[resume.offset]?.searchKey.startsWith(prefix))
    ) {
      throw new InspectionExecutionTraceError(
        "restart-required",
        "Execution trace index continuation position changed; restart from the first page.",
      );
    }
    const position = resume ?? this.seek(prefix);
    for (let page = position.page; page < this.storage.count; page += 1) {
      const entries = this.read(page);
      const start = page === position.page ? position.offset : 0;
      for (let offset = start; offset < entries.length; offset += 1) {
        const entry = entries[offset];
        if (entry === undefined || !entry.searchKey.startsWith(prefix)) return;
        yield { entry, position: { page, offset } };
      }
    }
  }
}

export type ExecutionTraceRecordReader = NonNullable<ReturnType<typeof openExecutionTraceRecord>>;
