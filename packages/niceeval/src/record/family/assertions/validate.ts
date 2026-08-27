import {
  recordAttachmentIssue,
  type RecordAttachmentIssue,
} from "../../attachment/index.ts";
import { MAX_ASSERTION_DOCUMENT_BYTES } from "../../../assertions/record/codec.ts";
import type { AssertionsAttachment } from "./schema.ts";

function startsAfterEnd(site: AssertionsAttachment["sourceSites"][number]): boolean {
  return site.start.line > site.end.line ||
    (site.start.line === site.end.line && site.start.column > site.end.column);
}

function encodedBytes(value: unknown): number | undefined {
  try {
    const encoded = JSON.stringify(value);
    return encoded === undefined ? undefined : new TextEncoder().encode(encoded).byteLength;
  } catch {
    return undefined;
  }
}

/** Named, deterministic current-fact invariants. */
export function validateAssertionsAttachment(
  value: AssertionsAttachment,
): readonly RecordAttachmentIssue[] {
  const issues: RecordAttachmentIssue[] = [];
  const entryIds = new Set<string>();
  for (const [index, entry] of value.entries.entries()) {
    if (entryIds.has(entry.entryId)) {
      issues.push(recordAttachmentIssue("record-attachment-schema-invalid", [
        "entries",
        String(index),
        "entryId",
      ]));
    }
    entryIds.add(entry.entryId);
  }

  const sourceOrders = new Set<number>();
  let previous: string | undefined;
  for (const [index, site] of value.sourceSites.entries()) {
    const key = `${site.entryId}\u0000${site.sourceOrder.toString().padStart(16, "0")}`;
    if (
      !entryIds.has(site.entryId) ||
      sourceOrders.has(site.sourceOrder) ||
      startsAfterEnd(site) ||
      previous !== undefined && previous >= key
    ) {
      issues.push(recordAttachmentIssue("record-attachment-schema-invalid", [
        "sourceSites",
        String(index),
      ]));
    }
    sourceOrders.add(site.sourceOrder);
    previous = key;
  }

  const size = encodedBytes(value);
  if (size === undefined || size > MAX_ASSERTION_DOCUMENT_BYTES) {
    issues.push(recordAttachmentIssue("record-attachment-schema-invalid", []));
  }
  return Object.freeze(issues);
}
