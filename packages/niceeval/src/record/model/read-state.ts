import type { RunId } from "./identifiers.ts";
import type { NonEmptyRecordIssues } from "../errors/record-errors.ts";

/** Core corruption is represented as readable state, not an Effect failure. */
export type RecordCoreRead<Value> =
  | { readonly state: "available"; readonly value: Value }
  | { readonly state: "missing" }
  | { readonly state: "core-invalid"; readonly issues: NonEmptyRecordIssues };

/**
 * Attachment state is independent from Core state. `Value` is intentionally
 * generic so the later materialized blob snapshot can be introduced without
 * changing this state machine.
 */
export type RecordAttachmentRead<Value> =
  | { readonly state: "available"; readonly value: Value }
  | { readonly state: "unavailable" }
  | {
      readonly state: "migration-required";
      readonly family: string;
      readonly fromSchemaVersion: number;
      readonly toSchemaVersion: number;
      readonly command: "niceeval migrate";
    }
  | {
      readonly state: "unsupported";
      readonly family: string;
      readonly schemaVersion: number;
    }
  | { readonly state: "invalid"; readonly issues: NonEmptyRecordIssues };

export interface RecordIncompleteRunWarning {
  readonly code: "incomplete-run";
  readonly runId: RunId;
  readonly cleanupCommand: "niceeval clean";
}

export type RecordWarning = RecordIncompleteRunWarning;
