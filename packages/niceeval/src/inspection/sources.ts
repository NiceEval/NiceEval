import { Either } from "effect";

import {
  hydrateRecordAttachmentCurrent,
} from "../record/attachment/protocol.ts";
import {
  mintRecordContentHandle,
  type RecordContentHandle,
} from "../record/attachment/content.ts";
import {
  NiceEvalCurrentRecordAttachments,
  NiceEvalRecordAttachments,
} from "../record/family/current.ts";
import type {
  PersistedContentMetadata,
  SealedAttachmentMetadata,
} from "../record/sqlite/index.ts";
import { closeInspectionJson, type InspectionJson } from "./codec.ts";
import { InspectionSha256, utf8ByteLength } from "./bytes.ts";
import type { InspectionAssertionsRead } from "./facts.ts";
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
  readonly sourceSites: Extract<
    InspectionAssertionsRead,
    { readonly state: "available" }
  >["value"]["sourceSites"];
}

interface UnavailableAssertions {
  readonly state: "not-recorded" | "invalid";
}

type AssertionsRead = AvailableAssertions | UnavailableAssertions;

type HydratedAssertionSourceSite = AvailableAssertions["sourceSites"][number];

interface SourcePosition {
  readonly line: number;
  readonly column: number;
}

export function projectAttemptSources(
  source: InspectionFactSource,
  attachment: SourcesAttachmentInput | undefined,
  assertions: InspectionAssertionsRead,
): InspectionJson {
  const assertionsRead = readAssertionSites(assertions);
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

function readAssertionSites(input: InspectionAssertionsRead): AssertionsRead {
  if (input.state === "available") {
    return Object.freeze({
      state: "available" as const,
      sourceSites: input.value.sourceSites,
    });
  }
  return Object.freeze({
    state: input.state === "not-recorded" ? "not-recorded" as const : "invalid" as const,
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
    attachment.physical.familyRevision !== NiceEvalCurrentRecordAttachments.sources.revision
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
  const digest = new InspectionSha256();
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
    digest.digestHex() !== metadata.digest) {
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
    throw closed;
  }
  return closed as InspectionJson;
}

function jsonByteLength(value: unknown): number {
  return utf8ByteLength(JSON.stringify(value));
}
