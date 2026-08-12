import { Effect } from "effect";
import type { RecordAttachmentRead } from "../record/model/read-state.ts";
import type { RecordAttachmentValue } from "../record/attachment/types.ts";
import type { RecordAttachmentSchemaId } from "../record/model/identifiers.ts";
import type { NonEmptyRecordIssues } from "../record/errors/record-errors.ts";

/**
 * The self-contained result of applying a projector to one Attachment read.
 * Record's non-available states remain successful data: Projection never
 * rewrites them into a reader failure or a Core state.
 */
export type ProjectedRecordAttachmentResult<Value> =
  | {
      readonly state: "available";
      readonly value: Value;
    }
  | { readonly state: "unavailable" }
  | {
      readonly state: "migration-required";
      readonly from: RecordAttachmentSchemaId;
      readonly to: RecordAttachmentSchemaId;
      readonly command: "niceeval migrate";
    }
  | {
      readonly state: "migration-unavailable";
      readonly from: RecordAttachmentSchemaId;
      readonly to: RecordAttachmentSchemaId;
      readonly reason: string;
    }
  | {
      readonly state: "unsupported";
      readonly schemaId: RecordAttachmentSchemaId;
    }
  | {
      readonly state: "invalid";
      readonly issues: NonEmptyRecordIssues;
    };

/**
 * A callback is intentionally evaluated only for a complete materialized
 * Attachment value. Effect.sync preserves an unexpected callback throw as a
 * defect and leaves interruption in the Effect Cause.
 */
export function projectRecordAttachmentRead<Payload, Value>(
  read: RecordAttachmentRead<RecordAttachmentValue<Payload>>,
  project: (value: RecordAttachmentValue<Payload>) => Value,
): Effect.Effect<ProjectedRecordAttachmentResult<Value>> {
  switch (read.state) {
    case "available":
      return Effect.sync(() =>
        Object.freeze({
          state: "available" as const,
          value: project(read.value),
        }),
      );
    case "unavailable":
      return Effect.succeed(Object.freeze({ state: "unavailable" as const }));
    case "migration-required":
      return Effect.succeed(
        Object.freeze({
          state: "migration-required" as const,
          from: read.from,
          to: read.to,
          command: read.command,
        }),
      );
    case "migration-unavailable":
      return Effect.succeed(
        Object.freeze({
          state: "migration-unavailable" as const,
          from: read.from,
          to: read.to,
          reason: read.reason,
        }),
      );
    case "unsupported":
      return Effect.succeed(
        Object.freeze({
          state: "unsupported" as const,
          schemaId: read.schemaId,
        }),
      );
    case "invalid":
      return Effect.succeed(
        Object.freeze({
          state: "invalid" as const,
          issues: read.issues,
        }),
      );
    default:
      return unreachableAttachmentRead(read);
  }
}

function unreachableAttachmentRead(value: never): never {
  throw new Error(`unknown Record Attachment read state: ${String(value)}`);
}
