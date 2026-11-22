import { readVerifiedRange } from "./artifacts.ts";
import type { InspectionFactSource } from "./source.ts";
import { Result } from "effect";

import { mintRecordContentHandle, type RecordContentHandle } from "../record/attachment/content.ts";
import { hydrateRecordAttachmentCurrent } from "../record/attachment/protocol.ts";
import { NiceEvalCurrentRecordAttachments } from "../record/family/current.ts";
import type {
  FileChange,
  FileChangesAttachment,
  FileEndpoint,
  FileRevision,
} from "../record/family/file-changes/schema.ts";
import type { PersistedContentMetadata } from "../record/sqlite/index.ts";
import type { DecodedInspectionAttachment } from "./facts.ts";
import type { InspectionAttemptDiffResult } from "./results.ts";

/** Projects the current File Changes authority into a closed, typed diff. */
export function projectAttemptDiff(
  attachment: DecodedInspectionAttachment | undefined,
  selection: {
    readonly source: InspectionFactSource;
    readonly changeId: string | undefined;
    readonly page: number;
    readonly next: () => string;
  },
): InspectionAttemptDiffResult {
  if (attachment === undefined) {
    return {
      state: "not-recorded",
      windows: [] as const,
    };
  }
  const current = NiceEvalCurrentRecordAttachments.fileChanges;
  if (
    attachment.physical.ownerKind !== "attempt" ||
    attachment.physical.family !== current.attachment.family ||
    attachment.physical.familyRevision !== current.revision
  ) {
    return invalidDiff("file-changes-revision-unsupported");
  }

  const byLogicalHandle = new Map(
    attachment.physical.contents.map((content) => [content.logicalHandle, content] as const),
  );
  const byHydratedHandle = new WeakMap<object, PersistedContentMetadata>();
  const usedLogicalHandles = new Set<string>();
  const hydrated = hydrateRecordAttachmentCurrent(current.attachment, attachment.value, {
    content: (token, declaration) => {
      const logicalHandle = exactMarker(token, "$niceeval.record.content");
      if (logicalHandle === undefined && !hasOwnMarker(token, "$niceeval.record.content")) {
        return Result.succeed(undefined);
      }
      const metadata = typeof logicalHandle === "string" ? byLogicalHandle.get(logicalHandle) : undefined;
      if (
        metadata === undefined ||
        usedLogicalHandles.has(logicalHandle as string) ||
        (declaration.maximumBytes !== undefined && metadata.byteLength > declaration.maximumBytes)
      ) {
        return Result.fail({ code: "current-content-bind-failed" as const });
      }
      const handle = mintRecordContentHandle(declaration.kind);
      byHydratedHandle.set(handle, metadata);
      usedLogicalHandles.add(logicalHandle as string);
      return Result.succeed(handle);
    },
    reference: () => Result.succeed(undefined),
  });
  if (Result.isFailure(hydrated) || usedLogicalHandles.size !== attachment.physical.contents.length) {
    return invalidDiff("file-changes-attachment-invalid");
  }

  const value: FileChangesAttachment = hydrated.success;
  const base = {
    state: value.collection.state,
    limitations: value.collection.limitations,
  };
  if (selection.changeId !== undefined) {
    for (const window of value.windows) {
      const change = window.changes.find((item) => item.changeId === selection.changeId);
      if (change === undefined) continue;
      const detail = changeDetail(change, byHydratedHandle, selection.source, selection.page);
      const hasMore = [detail.before, detail.after, detail.hunks].some(
        (part) => part.state === "available" && part.omittedBytes > 0,
      );
      return {
        ...base,
        detail,
        windows: [],
        omittedChangeCount: 0,
        omittedWindowCount: 0,
        ...(hasMore ? { continuation: selection.next() } : {}),
      };
    }
    return { ...base, windows: [], omittedChangeCount: 0, omittedWindowCount: 0 };
  }
  const page = windowPage(value.windows, byHydratedHandle, selection.page);
  return {
    ...base,
    ...page,
    ...(page.omittedWindowCount > 0 ? { continuation: selection.next() } : {}),
  };
}

type DiffWindow = Extract<InspectionAttemptDiffResult, { readonly state: "complete" | "partial" }>["windows"][number];

const CHANGES_PER_PAGE = 128;

/** An empty window occupies one slot so a long sequence of empty sends stays paged. */
function windowPage(
  entries: FileChangesAttachment["windows"],
  metadata: WeakMap<object, PersistedContentMetadata>,
  page: number,
) {
  const first = page * CHANGES_PER_PAGE;
  const last = first + CHANGES_PER_PAGE;
  let offset = 0;
  let omittedChangeCount = 0;
  let omittedWindowCount = 0;
  const windows: DiffWindow[] = [];
  for (const window of entries) {
    const next = offset + Math.max(1, window.changes.length);
    if (next > first && offset < last) {
      windows.push({
        windowId: window.windowId,
        sequence: window.sequence,
        changes: window.changes.slice(Math.max(0, first - offset), last - offset).map((change) => ({
          changeId: change.changeId,
          path: change.path,
          kind: change.kind,
          before: projectEndpoint(change.before, metadata),
          after: projectEndpoint(change.after, metadata),
        })),
      });
    }
    if (next > last) {
      omittedWindowCount += 1;
      omittedChangeCount += Math.max(0, window.changes.length - Math.max(0, last - offset));
    }
    offset = next;
  }
  return { windows, omittedChangeCount, omittedWindowCount };
}

function projectEndpoint(
  endpoint: FileEndpoint,
  metadata: WeakMap<object, PersistedContentMetadata>,
): DiffWindow["changes"][number]["before"] {
  if (endpoint.state === "absent") return { state: "absent" };
  return {
    state: "present",
    revision: projectRevision(endpoint.revision, metadata),
  };
}

function projectRevision(revision: FileRevision, metadata: WeakMap<object, PersistedContentMetadata>) {
  if (revision.kind !== "text") return revision;
  if (revision.content.state === "omitted") {
    return {
      kind: revision.kind,
      sha256: revision.sha256,
      byteLength: revision.byteLength,
      content: "omitted" as const,
    };
  }
  requireContentMetadata(revision.content.content, revision, metadata);
  return {
    kind: revision.kind,
    sha256: revision.sha256,
    byteLength: revision.byteLength,
    content: "available" as const,
  };
}

function requireContentMetadata(
  content: RecordContentHandle,
  revision: Extract<FileRevision, { readonly kind: "text" }>,
  metadata: WeakMap<object, PersistedContentMetadata>,
): PersistedContentMetadata {
  const physical = metadata.get(content);
  if (physical === undefined || physical.byteLength !== revision.byteLength || physical.digest !== revision.sha256) {
    throw new Error("File Changes content metadata is invalid");
  }
  return physical;
}

function invalidDiff(issue: string): InspectionAttemptDiffResult {
  return {
    state: "invalid",
    issues: [issue],
    windows: [] as const,
  };
}

function exactMarker(value: unknown, key: string): unknown | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== 1 || keys[0] !== key) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined && descriptor.enumerable && "value" in descriptor ? descriptor.value : undefined;
}

function hasOwnMarker(value: unknown, key: string): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.prototype.hasOwnProperty.call(value, key)
  );
}

const BODY_PAGE_BYTES = 16 * 1024;
const HUNK_PAGE_BYTES = 32 * 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/** Adjacent nominal pages share a boundary at the start of a complete code point. */
function diffTextPage(bytes: Uint8Array, size: number, page: number) {
  const boundary = (offset: number) => {
    let index = Math.min(offset, bytes.byteLength);
    while (index > 0 && index < bytes.byteLength && (bytes[index]! & 0xc0) === 0x80) index -= 1;
    return index;
  };
  const offset = boundary(page * size);
  const endOffset = boundary((page + 1) * size);
  const omittedBytes = bytes.byteLength - endOffset;
  return {
    text: decoder.decode(bytes.subarray(offset, endOffset)),
    byteLength: bytes.byteLength,
    offset,
    endOffset,
    omittedBytes,
    truncated: omittedBytes > 0,
    truncatedAtByte: omittedBytes > 0 ? endOffset : null,
  };
}

function changeDetail(
  change: FileChange,
  metadata: WeakMap<object, PersistedContentMetadata>,
  source: InspectionFactSource,
  page: number,
) {
  const body = (endpoint: FileEndpoint) => {
    if (endpoint.state === "absent") return { state: "absent" as const };
    const revision = endpoint.revision;
    if (revision.kind !== "text") return { state: revision.reason };
    if (revision.content.state === "omitted") return { state: "omitted" as const };
    const physical = requireContentMetadata(revision.content.content, revision, metadata);
    return { state: "available" as const, bytes: readVerifiedRange(source, physical, 0, physical.byteLength) };
  };
  const before = body(change.before);
  const after = body(change.after);
  const readable = (endpoint: typeof before) => endpoint.state === "available" || endpoint.state === "absent";
  const available = readable(before) && readable(after);
  const text = (endpoint: typeof before) => (endpoint.state === "available" ? decoder.decode(endpoint.bytes) : "");
  const pageBody = (endpoint: typeof before) =>
    endpoint.state === "available"
      ? { state: endpoint.state, ...diffTextPage(endpoint.bytes, BODY_PAGE_BYTES, page) }
      : endpoint;
  return {
    changeId: change.changeId,
    path: change.path,
    before: pageBody(before),
    after: pageBody(after),
    hunks: {
      state: available ? ("available" as const) : ("unavailable" as const),
      ...diffTextPage(
        encoder.encode(available ? unifiedReplacement(text(before), text(after), change.path) : ""),
        HUNK_PAGE_BYTES,
        page,
      ),
    },
  };
}

/** Linear replacement hunk; common prefix/suffix lines stay outside the changed range. */
function unifiedReplacement(before: string, after: string, path: string): string {
  const lines = (text: string) => text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const left = lines(before),
    right = lines(after);
  let prefix = 0;
  while (prefix < left.length && prefix < right.length && left[prefix] === right[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < left.length - prefix &&
    suffix < right.length - prefix &&
    left[left.length - suffix - 1] === right[right.length - suffix - 1]
  )
    suffix++;
  const removed = left.slice(prefix, left.length - suffix),
    added = right.slice(prefix, right.length - suffix);
  if (removed.length === 0 && added.length === 0) return "";
  const line = (value: string, sign: string) =>
    sign + value + (value.endsWith("\n") ? "" : "\n\\ No newline at end of file\n");
  return (
    `--- a/${path}\n+++ b/${path}\n@@ -${removed.length === 0 ? prefix : prefix + 1},${removed.length} +${added.length === 0 ? prefix : prefix + 1},${added.length} @@\n` +
    removed.map((text) => line(text, "-")).join("") +
    added.map((text) => line(text, "+")).join("")
  );
}
