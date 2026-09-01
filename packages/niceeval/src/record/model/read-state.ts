import type { RunId } from "./identifiers.ts";
import type { NonEmptyRecordIssues } from "../errors/record-errors.ts";

/** Core corruption is represented as readable state, not an Effect failure. */
export type RecordCoreRead<Value> =
  | { readonly state: "available"; readonly value: Value }
  | { readonly state: "missing" }
  | { readonly state: "core-invalid"; readonly issues: NonEmptyRecordIssues };

/**
 * Pure canonical Attachment state. Host code may enrich only the available
 * branch with a scope-owned live capability.
 */
export type RecordAttachmentRead<Value> =
  | { readonly state: "available"; readonly value: Value }
  | { readonly state: "not-recorded" }
  | {
      readonly state: "migration-required";
      readonly family: string;
      readonly fromRevision: number;
      readonly toRevision: number;
      readonly command: "niceeval migrate";
    }
  | {
      readonly state: "unsupported";
      readonly family: string;
      readonly revision: number;
    }
  | { readonly state: "invalid"; readonly issues: NonEmptyRecordIssues };

export interface RecordIncompleteRunWarning {
  readonly code: "incomplete-run";
  readonly runId: RunId;
  readonly cleanupCommand: "niceeval clean";
}

export type RecordWarning = RecordIncompleteRunWarning;
