import { readVerifiedRange } from "./artifacts.ts";
import type { InspectionFactSource } from "./source.ts";
import { Result } from "effect";

import {
  mintRecordContentHandle,
  type RecordContentHandle,
} from "../record/attachment/content.ts";
import { hydrateRecordAttachmentCurrent } from "../record/attachment/protocol.ts";
import { NiceEvalCurrentRecordAttachments } from "../record/family/current.ts";
import type {
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
  selection?: { readonly source: InspectionFactSource; readonly changeId: string },
): InspectionAttemptDiffResult {
  if (attachment === undefined) {
    return Object.freeze({
      state: "not-recorded",
      windows: Object.freeze([] as const),
    });
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
  const hydrated = hydrateRecordAttachmentCurrent(
    current.attachment,
    attachment.value,
    {
      content: (token, declaration) => {
        const logicalHandle = exactMarker(token, "$niceeval.record.content");
        if (logicalHandle === undefined && !hasOwnMarker(token, "$niceeval.record.content")) {
          return Result.succeed(undefined);
        }
        const metadata = typeof logicalHandle === "string"
          ? byLogicalHandle.get(logicalHandle)
          : undefined;
        if (
          metadata === undefined ||
          usedLogicalHandles.has(logicalHandle as string) ||
          declaration.maximumBytes !== undefined && metadata.byteLength > declaration.maximumBytes
        ) {
          return Result.fail({ code: "current-content-bind-failed" as const });
        }
        const handle = mintRecordContentHandle(declaration.kind);
        byHydratedHandle.set(handle, metadata);
        usedLogicalHandles.add(logicalHandle as string);
        return Result.succeed(handle);
      },
      reference: () => Result.succeed(undefined),
    },
  );
  if (
    Result.isFailure(hydrated) ||
    usedLogicalHandles.size !== attachment.physical.contents.length
  ) {
    return invalidDiff("file-changes-attachment-invalid");
  }

  const value: FileChangesAttachment = hydrated.success;
  const change = selection === undefined ? undefined : value.windows.flatMap((window) => window.changes).find((change) => change.changeId === selection.changeId);
  const detail = change === undefined || selection === undefined ? undefined : changeDetail(change, byHydratedHandle, selection.source);
  return Object.freeze({
    ...(detail === undefined ? {} : { detail }),
    state: value.collection.state,
    limitations: Object.freeze([...value.collection.limitations]),
    windows: Object.freeze(value.windows.map((window) => Object.freeze({
      windowId: window.windowId,
      sequence: window.sequence,
      changes: Object.freeze(window.changes.map((change) => Object.freeze({
        changeId: change.changeId,
        path: change.path,
        kind: change.kind,
        before: projectEndpoint(change.before, byHydratedHandle),
        after: projectEndpoint(change.after, byHydratedHandle),
      }))),
    }))),
  });
}

function projectEndpoint(
  endpoint: FileEndpoint,
  metadata: WeakMap<object, PersistedContentMetadata>,
): InspectionAttemptDiffResult extends infer Result
  ? Result extends { readonly windows: readonly (infer Window)[] }
    ? Window extends { readonly changes: readonly (infer Change)[] }
      ? Change extends { readonly before: infer Endpoint } ? Endpoint : never
      : never
    : never
  : never {
  if (endpoint.state === "absent") return Object.freeze({ state: "absent" });
  return Object.freeze({
    state: "present",
    revision: projectRevision(endpoint.revision, metadata),
  });
}

function projectRevision(
  revision: FileRevision,
  metadata: WeakMap<object, PersistedContentMetadata>,
) {
  if (revision.kind !== "text") return Object.freeze({ ...revision });
  if (revision.content.state === "omitted") {
    return Object.freeze({
      kind: revision.kind,
      sha256: revision.sha256,
      byteLength: revision.byteLength,
      content: "omitted" as const,
    });
  }
  requireContentMetadata(revision.content.content, revision, metadata);
  return Object.freeze({
    kind: revision.kind,
    sha256: revision.sha256,
    byteLength: revision.byteLength,
    content: "available" as const,
  });
}

function requireContentMetadata(
  content: RecordContentHandle,
  revision: Extract<FileRevision, { readonly kind: "text" }>,
  metadata: WeakMap<object, PersistedContentMetadata>,
): void {
  const physical = metadata.get(content);
  if (
    physical === undefined ||
    physical.byteLength !== revision.byteLength ||
    physical.digest !== revision.sha256
  ) {
    throw new Error("File Changes content metadata is invalid");
  }
}

function invalidDiff(issue: string): InspectionAttemptDiffResult {
  return Object.freeze({
    state: "invalid",
    issues: Object.freeze([issue]),
    windows: Object.freeze([] as const),
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

// Keep independently bounded endpoints and hunks comfortably inside the operation budget.
const BODY_BYTES = 16 * 1024;
const HUNK_BYTES = 32 * 1024;
function boundedDiffText(text: string, maximum: number) {
  const bytes = new TextEncoder().encode(text);
  let end = Math.min(maximum, bytes.length);
  while (end < bytes.length && end > 0 && (bytes[end]! & 0xc0) === 0x80) end--;
  return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, end)),
    truncated: end < bytes.length, truncatedAtByte: end < bytes.length ? end : null };
}
function changeDetail(
  change: FileChangesAttachment["windows"][number]["changes"][number],
  metadata: WeakMap<object, PersistedContentMetadata>, source: InspectionFactSource,
) {
  const body = (endpoint: FileEndpoint) => {
    if (endpoint.state === "absent") return { state: "absent" as const };
    const revision = endpoint.revision;
    if (revision.kind !== "text") return { state: revision.reason };
    if (revision.content.state === "omitted") return { state: "omitted" as const };
    const physical = metadata.get(revision.content.content);
    if (physical === undefined) throw new Error("Missing diff content metadata");
    const bytes = readVerifiedRange(source, physical, 0, BODY_BYTES + 4);
    // A prefix can end in the middle of a UTF-8 code point. Streaming decode retains it.
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes, { stream: bytes.length < physical.byteLength });
    const bounded = boundedDiffText(text, BODY_BYTES);
    const truncated = physical.byteLength > new TextEncoder().encode(bounded.text).length;
    return { state: "available" as const, ...bounded, byteLength: physical.byteLength,
      truncated, truncatedAtByte: truncated ? new TextEncoder().encode(bounded.text).length : null };
  };
  const before = body(change.before), after = body(change.after);
  const readable = (endpoint: typeof before) => endpoint.state === "available" || endpoint.state === "absent";
  const available = readable(before) && readable(after);
  const unified = available ? unifiedReplacement(
    before.state === "available" ? before.text : "", after.state === "available" ? after.text : "", change.path,
  ) : "";
  const bounded = boundedDiffText(unified, HUNK_BYTES);
  const truncated = bounded.truncated || before.state === "available" && before.truncated || after.state === "available" && after.truncated;
  return { changeId: change.changeId, path: change.path, before, after,
    hunks: { state: available ? "available" as const : "unavailable" as const, ...bounded,
      truncated, truncatedAtByte: truncated ? new TextEncoder().encode(bounded.text).length : null } };
}

/** Linear replacement hunk; common prefix/suffix lines stay outside the changed range. */
function unifiedReplacement(before: string, after: string, path: string): string {
  const lines = (text: string) => text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const left = lines(before), right = lines(after);
  let prefix = 0;
  while (prefix < left.length && prefix < right.length && left[prefix] === right[prefix]) prefix++;
  let suffix = 0;
  while (suffix < left.length - prefix && suffix < right.length - prefix && left[left.length - suffix - 1] === right[right.length - suffix - 1]) suffix++;
  const removed = left.slice(prefix, left.length - suffix), added = right.slice(prefix, right.length - suffix);
  if (removed.length === 0 && added.length === 0) return "";
  const line = (value: string, sign: string) => sign + value + (value.endsWith("\n") ? "" : "\n\\ No newline at end of file\n");
  return `--- a/${path}\n+++ b/${path}\n@@ -${removed.length === 0 ? prefix : prefix + 1},${removed.length} +${added.length === 0 ? prefix : prefix + 1},${added.length} @@\n` +
    removed.map((text) => line(text, "-")).join("") + added.map((text) => line(text, "+")).join("");
}
