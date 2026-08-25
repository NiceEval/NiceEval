import { createHash } from "node:crypto";

import { Either } from "effect";

import {
  enumerateRecordAttachmentClosure,
  hydrateRecordAttachmentCurrent,
  mintRecordAttachmentReference,
  RecordAttachmentReference,
  recordAttachmentReferenceWire,
} from "../record/attachment/protocol.ts";
import {
  mintRecordContentHandle,
  type RecordContentHandle,
} from "../record/attachment/content.ts";
import { NiceEvalRecordAttachments } from "../record/family/catalog.ts";
import { assertionsRecordAttachmentPersistence } from "../record/family/assertions/persistence.ts";
import { sourcesRecordAttachmentPersistence } from "../record/family/sources/persistence.ts";
import type {
  PersistedContentMetadata,
  SealedAttachmentMetadata,
} from "../record/sqlite/index.ts";
import { closeInspectionJson, type InspectionJson } from "./codec.ts";
import { INSPECTION_RESULT_BYTE_LIMIT } from "./limits.ts";
import type { InspectionFactSource } from "./source.ts";

const SOURCES_PROJECTION_FORMAT = "niceeval.inspection.sources/v1";
const SOURCE_TEXT_BYTE_LIMIT = 256 * 1024;
const SOURCE_RESULT_HEADROOM = 1024;
const CONTENT_PAGE_SIZE = 64;

export interface SourcesAttachmentInput {
  readonly physical: SealedAttachmentMetadata;
  readonly value: InspectionJson;
}

/** The exact current Attempt-owned Assertions physical metadata and wire value. */
export interface AssertionsAttachmentInput {
  readonly physical: SealedAttachmentMetadata;
  readonly value: InspectionJson;
}

interface HydratedSourceItem {
  readonly sourceItemId: string;
  readonly path: string;
  readonly byteLength: number;
  readonly sha256: string;
  readonly content: RecordContentHandle;
}

interface BoundSourceItem {
  readonly item: HydratedSourceItem;
  readonly content: PersistedContentMetadata;
}

type AttachmentReadState = "available" | "not-recorded" | "invalid";

interface AvailableAssertions {
  readonly state: "available";
  readonly sourceSites: readonly HydratedAssertionSourceSite[];
}

interface UnavailableAssertions {
  readonly state: "not-recorded" | "invalid";
}

type AssertionsRead = AvailableAssertions | UnavailableAssertions;

interface HydratedAssertionSourceSite {
  readonly entryId: string;
  readonly sourceOrder: number;
  readonly role: string;
  readonly source: RecordAttachmentReference<typeof NiceEvalRecordAttachments.sources, {
    readonly sourceItemId: string;
    readonly sha256: string;
  }>;
  readonly start: { readonly line: number; readonly column: number };
  readonly end: { readonly line: number; readonly column: number };
}

interface SourcePosition {
  readonly line: number;
  readonly column: number;
}

export function projectAttemptSources(
  source: InspectionFactSource,
  attachment: SourcesAttachmentInput | undefined,
  assertions?: AssertionsAttachmentInput,
): InspectionJson {
  const assertionsRead = hydrateAssertions(assertions);
  let state: AttachmentReadState = attachment === undefined ? "not-recorded" : "available";
  let decoded: readonly BoundSourceItem[] = [];
  if (attachment !== undefined) {
    try {
      decoded = hydrateSourceItems(attachment);
    } catch {
      state = "invalid";
    }
  }

  const items: InspectionJson[] = [];
  const requestedPositions = assertionSourcePositions(assertionsRead);
  const verifiedSourcePositions = new Map<string, ReadonlySet<string>>();
  let projectedBytes = jsonByteLength(Object.freeze({
    format: SOURCES_PROJECTION_FORMAT,
    state,
    items: Object.freeze([]),
    hasMore: decoded.length > 0,
    omittedItemCount: decoded.length,
  }));
  let acceptProjectedItems = true;

  try {
    for (const entry of state === "available" ? decoded : []) {
      const omitted = projectedSourceItem(entry, omittedContent(entry.content.byteLength));
      const omittedBytes = jsonByteLength(omitted) + (items.length === 0 ? 0 : 1);
      const includeItem = acceptProjectedItems &&
        projectedBytes + omittedBytes <= INSPECTION_RESULT_BYTE_LIMIT - SOURCE_RESULT_HEADROOM;
      if (!includeItem) acceptProjectedItems = false;

      let projected = omitted;
      const positions = requestedPositions.get(entry.item.sourceItemId) ?? Object.freeze([]);
      const verified = positions.length > 0 || includeItem && entry.content.byteLength <= SOURCE_TEXT_BYTE_LIMIT
        ? readVerifiedSource(source, entry.content, positions)
        : undefined;
      if (verified !== undefined) {
        verifiedSourcePositions.set(entry.item.sourceItemId, verified.displayablePositions);
      }
      if (verified?.text !== undefined) {
        const available = projectedSourceItem(entry, Object.freeze({
          state: "available" as const,
          text: verified.text,
        }));
        const availableBytes = jsonByteLength(available) + (items.length === 0 ? 0 : 1);
        if (projectedBytes + availableBytes <= INSPECTION_RESULT_BYTE_LIMIT - SOURCE_RESULT_HEADROOM) {
          projected = available;
        }
      }
      if (!includeItem) continue;

      const itemBytes = jsonByteLength(projected) + (items.length === 0 ? 0 : 1);
      items.push(projected);
      projectedBytes += itemBytes;
    }
  } catch {
    state = "invalid";
    decoded = Object.freeze([]);
    items.splice(0, items.length);
    verifiedSourcePositions.clear();
  }

  const sourceItems = new Map(decoded.map((entry) => [entry.item.sourceItemId, entry] as const));
  const sites = assertionsRead.state === "available"
    ? assertionsRead.sourceSites.map((site) => projectAssertionSourceSite(
        site,
        state,
        sourceItems,
        verifiedSourcePositions,
      ))
    : [];

  let projectedSiteCount = sites.length;
  let result = sourceResult(state, items, decoded.length, assertionResult(assertionsRead, sites, projectedSiteCount));
  while (jsonByteLength(result) > INSPECTION_RESULT_BYTE_LIMIT && items.length > 0) {
    items.pop();
    result = sourceResult(state, items, decoded.length, assertionResult(assertionsRead, sites, projectedSiteCount));
  }
  while (jsonByteLength(result) > INSPECTION_RESULT_BYTE_LIMIT && projectedSiteCount > 0) {
    projectedSiteCount -= 1;
    result = sourceResult(
      state,
      items,
      decoded.length,
      assertionResult(assertionsRead, sites, projectedSiteCount),
    );
  }
  if (jsonByteLength(result) > INSPECTION_RESULT_BYTE_LIMIT) {
    throw new Error("Sources projection cannot fit its fixed result byte limit");
  }
  return closeJson(result);
}

function assertionSourcePositions(
  assertions: AssertionsRead,
): ReadonlyMap<string, readonly SourcePosition[]> {
  const output = new Map<string, SourcePosition[]>();
  if (assertions.state !== "available") return output;
  for (const site of assertions.sourceSites) {
    const sourceItemId = site.source.value.sourceItemId;
    const positions = output.get(sourceItemId) ?? [];
    positions.push(site.start, site.end);
    output.set(sourceItemId, positions);
  }
  return new Map([...output].map(([sourceItemId, positions]) => [
    sourceItemId,
    Object.freeze(positions),
  ] as const));
}

/**
 * Binds only revision-4 Assertions wire leaves to the sealed physical
 * inventory. An unreadable Assertions attachment remains an attachment-level
 * state; it never becomes an empty successful source-site collection.
 */
function hydrateAssertions(input: AssertionsAttachmentInput | undefined): AssertionsRead {
  if (input === undefined) return Object.freeze({ state: "not-recorded" as const });
  if (
    input.physical.family !== NiceEvalRecordAttachments.assertions.family ||
    input.physical.ownerKind !== "attempt" ||
    input.physical.familyRevision !== assertionsRecordAttachmentPersistence.revision
  ) {
    return Object.freeze({ state: "invalid" as const });
  }

  try {
    const byLogicalHandle = new Map(
      input.physical.contents.map((content) => [content.logicalHandle, content] as const),
    );
    const handles = new Map<string, RecordContentHandle>();
    const usedLogicalHandles = new Set<string>();
    const hydrated = hydrateRecordAttachmentCurrent(
      NiceEvalRecordAttachments.assertions,
      input.value,
      {
        content: (token, declaration) => {
          const logicalHandle = exactMarker(token, "$niceeval.record.content");
          if (logicalHandle === undefined && !hasOwnMarker(token, "$niceeval.record.content")) {
            return Either.right(undefined);
          }
          const metadata = typeof logicalHandle === "string"
            ? byLogicalHandle.get(logicalHandle)
            : undefined;
          if (
            metadata === undefined ||
            declaration.maximumBytes !== undefined && metadata.byteLength > declaration.maximumBytes
          ) {
            return Either.left({ code: "current-content-bind-failed" as const });
          }
          let handle = handles.get(logicalHandle as string);
          if (handle === undefined) {
            handle = mintRecordContentHandle(declaration.kind);
            handles.set(logicalHandle as string, handle);
          }
          usedLogicalHandles.add(logicalHandle as string);
          return Either.right(handle);
        },
        reference: (token, declaration) => {
          const marker = exactMarker(token, "$niceeval.record.reference");
          if (marker === undefined && !hasOwnMarker(token, "$niceeval.record.reference")) {
            return Either.right(undefined);
          }
          if (typeof marker !== "object" || marker === null || Array.isArray(marker)) {
            return Either.left({ code: "current-reference-bind-failed" as const });
          }
          const value = marker as Record<string, unknown>;
          if (
            Reflect.ownKeys(value).length !== 3 ||
            value.owner !== declaration.definition.owner ||
            value.family !== declaration.definition.family ||
            !("value" in value)
          ) {
            return Either.left({ code: "current-reference-bind-failed" as const });
          }
          return Either.right(mintRecordAttachmentReference(
            RecordAttachmentReference.to(declaration.definition, declaration.valueSchema),
            value.value,
          ));
        },
      },
    );
    if (Either.isLeft(hydrated) || usedLogicalHandles.size !== input.physical.contents.length) {
      return Object.freeze({ state: "invalid" as const });
    }
    if (!referencesMatchPhysicalInventory(input.physical, hydrated.right)) {
      return Object.freeze({ state: "invalid" as const });
    }
    return Object.freeze({
      state: "available" as const,
      sourceSites: Object.freeze([
        ...(hydrated.right.sourceSites as readonly HydratedAssertionSourceSite[]),
      ]),
    });
  } catch {
    return Object.freeze({ state: "invalid" as const });
  }
}

function referencesMatchPhysicalInventory(
  physical: SealedAttachmentMetadata,
  value: unknown,
): boolean {
  const closure = enumerateRecordAttachmentClosure(NiceEvalRecordAttachments.assertions, value);
  if (Either.isLeft(closure)) return false;
  const references = new Map<string, { readonly owner: string; readonly family: string }>();
  for (const reference of closure.right.references) {
    const wire = recordAttachmentReferenceWire(reference);
    if (wire === undefined) return false;
    references.set(`${wire.owner}\u0000${wire.family}`, Object.freeze({
      owner: wire.owner,
      family: wire.family,
    }));
  }
  const ordered = [...references.values()].sort((left, right) =>
    left.owner === right.owner
      ? left.family === right.family ? 0 : left.family < right.family ? -1 : 1
      : left.owner < right.owner ? -1 : 1);
  if (ordered.length !== physical.references.length) return false;
  return ordered.every((reference, ordinal) => {
    const persisted = physical.references[ordinal];
    return persisted !== undefined &&
      persisted.ordinal === ordinal &&
      persisted.owner === reference.owner &&
      persisted.family === reference.family;
  });
}

function projectAssertionSourceSite(
  site: HydratedAssertionSourceSite,
  sourceState: AttachmentReadState,
  sourceItems: ReadonlyMap<string, BoundSourceItem>,
  verifiedSourcePositions: ReadonlyMap<string, ReadonlySet<string>>,
): InspectionJson {
  const anchor = site.source.value;
  const item = sourceState === "available" ? sourceItems.get(anchor.sourceItemId) : undefined;
  const source = item === undefined || item.item.sha256 !== anchor.sha256
    ? unmappedSource("source-snapshot-not-recorded")
    : !positionsAreDisplayable(
        verifiedSourcePositions.get(anchor.sourceItemId),
        site.start,
        site.end,
      )
      ? unmappedSource("position-unrepresentable")
      : Object.freeze({
          state: "mapped" as const,
          sourceItemId: anchor.sourceItemId,
          sha256: anchor.sha256,
        });
  return closeJson(Object.freeze({
    entryId: site.entryId,
    sourceOrder: site.sourceOrder,
    role: site.role,
    start: Object.freeze({ line: site.start.line, column: site.start.column }),
    end: Object.freeze({ line: site.end.line, column: site.end.column }),
    source,
  }));
}

function assertionResult(
  assertions: AssertionsRead,
  sites: readonly InspectionJson[],
  projectedSiteCount: number,
): InspectionJson {
  if (assertions.state !== "available") return closeJson(Object.freeze({ state: assertions.state }));
  return closeJson(Object.freeze({
    state: "available" as const,
    sourceSites: Object.freeze(sites.slice(0, projectedSiteCount)),
    hasMoreSourceSites: projectedSiteCount < sites.length,
    omittedSourceSiteCount: sites.length - projectedSiteCount,
  }));
}

function unmappedSource(reason: "source-snapshot-not-recorded" | "position-unrepresentable"): InspectionJson {
  return Object.freeze({ state: "unmapped" as const, reason });
}

function positionsAreDisplayable(
  positions: ReadonlySet<string> | undefined,
  start: SourcePosition,
  end: SourcePosition,
): boolean {
  return positions?.has(positionKey(start)) === true && positions.has(positionKey(end));
}

function positionKey(position: SourcePosition): string {
  return `${position.line}:${position.column}`;
}

function hydrateSourceItems(attachment: SourcesAttachmentInput): readonly BoundSourceItem[] {
  if (
    attachment.physical.ownerKind !== "run" ||
    attachment.physical.family !== NiceEvalRecordAttachments.sources.family ||
    attachment.physical.familyRevision !== sourcesRecordAttachmentPersistence.revision
  ) {
    throw new Error("Sources Attachment requires migration before Inspection");
  }
  const byLogicalHandle = new Map(
    attachment.physical.contents.map((content) => [content.logicalHandle, content] as const),
  );
  const byHydratedHandle = new WeakMap<object, PersistedContentMetadata>();
  const usedLogicalHandles = new Set<string>();
  const hydrated = hydrateRecordAttachmentCurrent(
    NiceEvalRecordAttachments.sources,
    attachment.value,
    {
      content: (token, declaration) => {
        const logicalHandle = exactMarker(token, "$niceeval.record.content");
        if (logicalHandle === undefined && !hasOwnMarker(token, "$niceeval.record.content")) {
          return Either.right(undefined);
        }
        const metadata = typeof logicalHandle === "string"
          ? byLogicalHandle.get(logicalHandle)
          : undefined;
        if (metadata === undefined || declaration.kind !== "text" ||
          declaration.maximumBytes !== undefined && metadata.byteLength > declaration.maximumBytes ||
          usedLogicalHandles.has(logicalHandle as string)) {
          return Either.left({ code: "current-content-bind-failed" as const });
        }
        const handle = mintRecordContentHandle("text");
        byHydratedHandle.set(handle, metadata);
        usedLogicalHandles.add(logicalHandle as string);
        return Either.right(handle);
      },
      reference: () => Either.right(undefined),
    },
  );
  if (Either.isLeft(hydrated) || usedLogicalHandles.size !== attachment.physical.contents.length) {
    throw new Error("Sources Attachment content closure is invalid");
  }

  const output: BoundSourceItem[] = [];
  for (const item of hydrated.right.items as readonly HydratedSourceItem[]) {
    const metadata = byHydratedHandle.get(item.content);
    if (metadata === undefined || metadata.byteLength !== item.byteLength || metadata.digest !== item.sha256) {
      throw new Error("Sources Attachment item does not match its sealed Content metadata");
    }
    output.push(Object.freeze({ item, content: metadata }));
  }
  return Object.freeze(output);
}

function readVerifiedSource(
  source: InspectionFactSource,
  metadata: PersistedContentMetadata,
  positions: readonly SourcePosition[],
): {
  readonly text?: string;
  readonly displayablePositions: ReadonlySet<string>;
} {
  const digest = createHash("sha256");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const retainText = metadata.byteLength <= SOURCE_TEXT_BYTE_LIMIT;
  const text: string[] = [];
  const positionsByLine = new Map<number, Set<number>>();
  for (const position of positions) {
    const columns = positionsByLine.get(position.line) ?? new Set<number>();
    columns.add(position.column - 1);
    positionsByLine.set(position.line, columns);
  }
  const displayablePositions = new Set<string>();
  let offset = 0;
  let afterOrdinal = -1;
  let expectedOrdinal = 0;
  let observedChunks = 0;
  let line = 1;
  let column = 0;

  const markPosition = (byte: number | undefined): void => {
    const columns = positionsByLine.get(line);
    if (columns?.has(column) !== true) return;
    if (byte === undefined || byte === 0x0a || (byte & 0b1100_0000) !== 0b1000_0000) {
      displayablePositions.add(`${line}:${column + 1}`);
    }
  };

  while (true) {
    const page = source.readContentPage(metadata.contentId, afterOrdinal, CONTENT_PAGE_SIZE);
    if (page.contentId !== metadata.contentId || page.afterOrdinal !== afterOrdinal ||
      page.chunks.length === 0 && page.nextOrdinal !== null) {
      throw new Error("Sources Content page is invalid");
    }
    for (const chunk of page.chunks) {
      if (chunk.ordinal !== expectedOrdinal || offset + chunk.bytes.byteLength > metadata.byteLength) {
        throw new Error("Sources Content chunk sequence is invalid");
      }
      digest.update(chunk.bytes);
      const decoded = decoder.decode(chunk.bytes, { stream: true });
      if (retainText) text.push(decoded);
      for (const byte of chunk.bytes) {
        markPosition(byte);
        if (byte === 0x0a) {
          line += 1;
          column = 0;
        } else {
          column += 1;
        }
      }
      offset += chunk.bytes.byteLength;
      expectedOrdinal += 1;
      observedChunks += 1;
    }
    if (page.nextOrdinal === null) break;
    if (page.nextOrdinal !== expectedOrdinal - 1 || observedChunks > metadata.chunkCount) {
      throw new Error("Sources Content continuation is invalid");
    }
    afterOrdinal = page.nextOrdinal;
  }

  const finalText = decoder.decode();
  if (retainText) text.push(finalText);
  markPosition(undefined);

  if (offset !== metadata.byteLength || observedChunks !== metadata.chunkCount ||
    digest.digest("hex") !== metadata.digest) {
    throw new Error("Sources Content does not match its sealed metadata");
  }
  return Object.freeze({
    ...(retainText ? { text: text.join("") } : {}),
    displayablePositions,
  });
}

function projectedSourceItem(
  entry: BoundSourceItem,
  content: InspectionJson,
): InspectionJson {
  return closeJson(Object.freeze({
    sourceItemId: entry.item.sourceItemId,
    path: entry.item.path,
    byteLength: entry.item.byteLength,
    sha256: entry.item.sha256,
    content,
  }));
}

function omittedContent(byteLength: number): InspectionJson {
  return closeJson(Object.freeze({
    state: "omitted" as const,
    reason: "inspection-result-byte-limit" as const,
    byteLength,
    byteLimit: SOURCE_TEXT_BYTE_LIMIT,
  }));
}

function sourceResult(
  state: AttachmentReadState,
  items: readonly InspectionJson[],
  total: number,
  assertions: InspectionJson,
): object {
  return Object.freeze({
    format: SOURCES_PROJECTION_FORMAT,
    state,
    items: Object.freeze([...items]),
    hasMore: items.length < total,
    omittedItemCount: total - items.length,
    assertions,
  });
}

function exactMarker(value: unknown, key: string): unknown | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== 1 || keys[0] !== key) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined && descriptor.enumerable && "value" in descriptor
    ? descriptor.value
    : undefined;
}

function hasOwnMarker(value: unknown, key: string): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value) &&
    Object.prototype.hasOwnProperty.call(value, key);
}

function closeJson(value: unknown): InspectionJson {
  const closed = closeInspectionJson(value);
  if (typeof closed === "object" && closed !== null && !Array.isArray(closed) &&
    Reflect.get(closed, "code") === "inspection-result-invalid") {
    throw new Error(String(Reflect.get(closed, "reason")));
  }
  return closed as InspectionJson;
}

function jsonByteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}
