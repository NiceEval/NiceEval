import type { AnalysisSample } from "../analysis/index.ts";
import type { ProjectedRecordAttachmentResult } from "./attachment-result.ts";

/**
 * Transport coverage is deliberately separate from a Calculation's domain
 * observed/denominator values. Every count is a logical public entry count.
 */
export interface ProjectionCoverage {
  readonly sample: {
    readonly denominator: number;
    readonly totalSlots: number;
    readonly included: number;
    readonly notRecorded: number;
    readonly coreInvalid: number;
    readonly excluded: number;
  };
  readonly entries: {
    readonly total: number;
    readonly attachmentResult: number;
    readonly notRecorded: number;
    readonly coreInvalid: number;
    readonly excluded: number;
  };
  readonly attachments: {
    readonly available: number;
    readonly unavailable: number;
    readonly migrationRequired: number;
    readonly migrationUnavailable: number;
    readonly unsupported: number;
    readonly invalid: number;
  };
}

/** The structural information required to count a completed logical access. */
export type ProjectionCoverageEntry<Value = unknown> =
  | { readonly state: "excluded" }
  | { readonly state: "not-recorded" }
  | { readonly state: "core-invalid" }
  | {
      readonly state: "attachment-result";
      readonly attachment: ProjectedRecordAttachmentResult<Value>;
    };

export function calculateProjectionCoverage<Value>(
  sample: Pick<AnalysisSample, "denominator" | "slots">,
  entries: readonly ProjectionCoverageEntry<Value>[],
): ProjectionCoverage {
  let included = 0;
  let sampleNotRecorded = 0;
  let sampleCoreInvalid = 0;
  let sampleExcluded = 0;

  for (const slot of sample.slots) {
    switch (slot.state) {
      case "included":
        included += 1;
        break;
      case "not-recorded":
        sampleNotRecorded += 1;
        break;
      case "core-invalid":
        sampleCoreInvalid += 1;
        break;
      case "excluded":
        sampleExcluded += 1;
        break;
      default:
        unreachableProjectionState(slot);
    }
  }

  let attachmentResult = 0;
  let entryNotRecorded = 0;
  let entryCoreInvalid = 0;
  let entryExcluded = 0;
  let available = 0;
  let unavailable = 0;
  let migrationRequired = 0;
  let migrationUnavailable = 0;
  let unsupported = 0;
  let invalid = 0;

  for (const entry of entries) {
    switch (entry.state) {
      case "excluded":
        entryExcluded += 1;
        break;
      case "not-recorded":
        entryNotRecorded += 1;
        break;
      case "core-invalid":
        entryCoreInvalid += 1;
        break;
      case "attachment-result":
        attachmentResult += 1;
        switch (entry.attachment.state) {
          case "available":
            available += 1;
            break;
          case "unavailable":
            unavailable += 1;
            break;
          case "migration-required":
            migrationRequired += 1;
            break;
          case "migration-unavailable":
            migrationUnavailable += 1;
            break;
          case "unsupported":
            unsupported += 1;
            break;
          case "invalid":
            invalid += 1;
            break;
          default:
            unreachableProjectionState(entry.attachment);
        }
        break;
      default:
        unreachableProjectionState(entry);
    }
  }

  return Object.freeze({
    sample: Object.freeze({
      denominator: sample.denominator,
      totalSlots: sample.slots.length,
      included,
      notRecorded: sampleNotRecorded,
      coreInvalid: sampleCoreInvalid,
      excluded: sampleExcluded,
    }),
    entries: Object.freeze({
      total: entries.length,
      attachmentResult,
      notRecorded: entryNotRecorded,
      coreInvalid: entryCoreInvalid,
      excluded: entryExcluded,
    }),
    attachments: Object.freeze({
      available,
      unavailable,
      migrationRequired,
      migrationUnavailable,
      unsupported,
      invalid,
    }),
  });
}

function unreachableProjectionState(value: never): never {
  throw new Error(`unknown Projection state: ${String(value)}`);
}
