import { createHash } from "node:crypto";

import { Either } from "effect";

import {
  hydrateRecordAttachmentCurrent,
} from "../record/attachment/protocol.ts";
import {
  mintRecordContentHandle,
  type RecordContentHandle,
} from "../record/attachment/content.ts";
import { NiceEvalRecordAttachments } from "../record/family/catalog.ts";
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

interface SourcesAttachmentInput {
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

export function projectAttemptSources(
  source: InspectionFactSource,
  attachment: SourcesAttachmentInput | undefined,
): InspectionJson {
  if (attachment === undefined) {
    return closeJson(Object.freeze({
      format: SOURCES_PROJECTION_FORMAT,
      state: "not-recorded" as const,
      items: Object.freeze([]),
      hasMore: false,
      omittedItemCount: 0,
    }));
  }

  const decoded = hydrateSourceItems(attachment);
  const items: InspectionJson[] = [];
  let projectedBytes = jsonByteLength(Object.freeze({
    format: SOURCES_PROJECTION_FORMAT,
    state: "available" as const,
    items: Object.freeze([]),
    hasMore: decoded.length > 0,
    omittedItemCount: decoded.length,
  }));

  for (const entry of decoded) {
    const omitted = projectedSourceItem(entry, omittedContent(entry.content.byteLength));
    const omittedBytes = jsonByteLength(omitted) + (items.length === 0 ? 0 : 1);
    if (projectedBytes + omittedBytes > INSPECTION_RESULT_BYTE_LIMIT - SOURCE_RESULT_HEADROOM) break;

    let projected = omitted;
    if (entry.content.byteLength <= SOURCE_TEXT_BYTE_LIMIT) {
      const text = readVerifiedText(source, entry.content);
      const available = projectedSourceItem(entry, Object.freeze({
        state: "available" as const,
        text,
      }));
      const availableBytes = jsonByteLength(available) + (items.length === 0 ? 0 : 1);
      if (projectedBytes + availableBytes <= INSPECTION_RESULT_BYTE_LIMIT - SOURCE_RESULT_HEADROOM) {
        projected = available;
      }
    }

    const itemBytes = jsonByteLength(projected) + (items.length === 0 ? 0 : 1);
    items.push(projected);
    projectedBytes += itemBytes;
  }

  let result = sourceResult(items, decoded.length);
  while (jsonByteLength(result) > INSPECTION_RESULT_BYTE_LIMIT && items.length > 0) {
    items.pop();
    result = sourceResult(items, decoded.length);
  }
  if (jsonByteLength(result) > INSPECTION_RESULT_BYTE_LIMIT) {
    throw new Error("Sources projection cannot fit its fixed result byte limit");
  }
  return closeJson(result);
}

function hydrateSourceItems(attachment: SourcesAttachmentInput): readonly BoundSourceItem[] {
  if (attachment.physical.familyRevision !== sourcesRecordAttachmentPersistence.revision) {
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

function readVerifiedText(
  source: InspectionFactSource,
  metadata: PersistedContentMetadata,
): string {
  if (metadata.byteLength > SOURCE_TEXT_BYTE_LIMIT) {
    throw new Error("Source Content exceeds the fixed text projection limit");
  }
  const bytes = new Uint8Array(metadata.byteLength);
  const digest = createHash("sha256");
  let offset = 0;
  let afterOrdinal = -1;
  let expectedOrdinal = 0;
  let observedChunks = 0;

  while (true) {
    const page = source.readContentPage(metadata.contentId, afterOrdinal, CONTENT_PAGE_SIZE);
    if (page.contentId !== metadata.contentId || page.afterOrdinal !== afterOrdinal ||
      page.chunks.length === 0 && page.nextOrdinal !== null) {
      throw new Error("Sources Content page is invalid");
    }
    for (const chunk of page.chunks) {
      if (chunk.ordinal !== expectedOrdinal || offset + chunk.bytes.byteLength > bytes.byteLength) {
        throw new Error("Sources Content chunk sequence is invalid");
      }
      bytes.set(chunk.bytes, offset);
      digest.update(chunk.bytes);
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

  if (offset !== metadata.byteLength || observedChunks !== metadata.chunkCount ||
    digest.digest("hex") !== metadata.digest) {
    throw new Error("Sources Content does not match its sealed metadata");
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (cause) {
    throw new Error("Sources Content is not valid UTF-8 text", { cause });
  }
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

function sourceResult(items: readonly InspectionJson[], total: number): object {
  return Object.freeze({
    format: SOURCES_PROJECTION_FORMAT,
    state: "available" as const,
    items: Object.freeze([...items]),
    hasMore: items.length < total,
    omittedItemCount: total - items.length,
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
