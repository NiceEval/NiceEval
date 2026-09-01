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
  return Object.freeze({
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
