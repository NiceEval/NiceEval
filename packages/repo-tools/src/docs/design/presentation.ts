import { isTraceError, type TraceError } from "../trace/errors.js";
import { TraceMutationError, type TraceCoordinationError } from "../trace/relation-mutation.js";
import {
  type DesignDomainError,
  isDesignDomainError,
} from "./errors.js";
import type { DesignReceipt } from "./model.js";

export type DesignPresentationError = DesignDomainError | TraceError | TraceCoordinationError;

export function isDesignPresentationError(value: unknown): value is DesignPresentationError {
  return isDesignDomainError(value) || isTraceError(value) || value instanceof TraceMutationError;
}

function jsonError(error: DesignPresentationError): string {
  return `${JSON.stringify({
    ok: false,
    error: Object.fromEntries(Object.entries(error)),
  }, null, 2)}\n`;
}

function humanError(error: DesignPresentationError): string {
  switch (error._tag) {
    case "DesignInputInvalid":
      return `${error._tag}: ${error.source}: ${error.message}`;
    case "DesignIoError":
      return `${error._tag}: ${error.operation} ${error.path}: ${error.message}`;
    case "DesignManifestInvalid":
      return `${error._tag}: ${error.path}: ${error.message}`;
    case "DesignSelectorMissing":
      return `${error._tag}: no ${error.subject} matches ${JSON.stringify(error.selector)}. ${error.nextStep}`;
    case "DesignSelectorAmbiguous":
      return `${error._tag}: ${JSON.stringify(error.selector)} is ambiguous:\n${error.candidates.map((item) => `  ${item}`).join("\n")}`;
    case "DesignConflict":
      return `${error._tag}: cannot ${error.operation} ${error.path}: ${error.message}`;
    case "DesignAlreadyDecided":
      return `${error._tag}: ${error.design} already selected ${error.selectedPlan}; requested ${error.requestedPlan}. ${error.message}`;
    case "DesignDecisionIncomplete":
      return `${error._tag}: ${error.design} cannot select ${error.plan}:\n${error.findings.map((item) => `  - ${item}`).join("\n")}\nNext: ${error.nextStep}`;
    case "TraceMutationError":
      return `${error._tag}: ${error.operation} ${error.phase}${error.path === undefined ? "" : ` ${error.path}`}: ${error.message}`;
    case "TraceRecoveryRequired":
      return `${error._tag}: unfinished Trace publication at ${error.path}; run pnpm run repo trace recover`;
    case "TraceRecoveryConflict":
      return `${error._tag}: ${error.path}: ${error.message}`;
    case "TraceIoError":
      return `${error._tag}: ${error.operation} ${error.path}: ${error.message}`;
    case "TraceFormatError":
      return `${error._tag}: ${error.path} (${error.subject}): ${error.message}`;
    case "TraceSelectorMissing":
      return `${error._tag}: no ${error.subject} matches ${JSON.stringify(error.selector)}`;
    case "TraceSelectorAmbiguous":
      return `${error._tag}: ${JSON.stringify(error.selector)} is ambiguous:\n${error.candidates.map((item) => `  ${item}`).join("\n")}`;
    case "TraceSnapshotChanged":
      return `${error._tag}: generation changed from ${error.before} to ${error.after} after ${error.attempts} attempts`;
    case "TraceMutationActive":
      return `${error._tag}: Trace mutation is active at ${error.path}`;
    case "TraceInputChanged":
      return `${error._tag}: Trace inputs changed after ${error.attempts} attempts: ${error.changed.join(", ")}`;
  }
}

export function renderDesignError(error: DesignPresentationError, json = false): string {
  return json ? jsonError(error) : `${humanError(error)}\n`;
}

function state(value: DesignReceipt["design"]["state"]): string {
  return value._tag === "undecided" ? "undecided" : `decided → ${value.selectedPlan}`;
}

function humanReceipt(receipt: DesignReceipt): string {
  switch (receipt.operation) {
    case "design-create":
      return [
        `${receipt.dryRun ? "Would create" : "Created"} Design ${receipt.design.slug} (${state(receipt.design.state)})`,
        `Path: ${receipt.design.ref}`,
        `Plans: ${receipt.plans.map((plan) => plan.selector).join(", ")}`,
        `Files: ${receipt.files.length}; generation ${receipt.generation} → ${receipt.nextGeneration}`,
        `Template manifests: design-decision ${receipt.manifestDigests.designDecision}; feature-design ${receipt.manifestDigests.featureDesign}`,
        `Next: pnpm run repo docs design check ${receipt.design.slug}`,
      ].join("\n");
    case "design-check":
      return [
        `Design ${receipt.design.slug}: ${receipt.ok ? "valid" : "invalid"} (${state(receipt.design.state)})`,
        `Plans: ${receipt.plans.map((plan) => plan.selector).join(", ") || "none"}`,
        `Files: ${receipt.files.length}; generation ${receipt.generation}`,
        ...(receipt.findings.length === 0
          ? []
          : ["Findings:", ...receipt.findings.map((item) => `  - ${item.code}: ${item.path}: ${item.message}`)]),
      ].join("\n");
    case "design-decide":
      return [
        `${receipt.dryRun ? "Would decide" : "Decided"} Design ${receipt.design.slug} → ${receipt.selectedPlan}`,
        `Path: ${receipt.design.ref}`,
        `Generation: ${receipt.generation} → ${receipt.nextGeneration}`,
        `Next: pnpm run repo docs design check ${receipt.design.slug}`,
      ].join("\n");
  }
}

export function renderDesignReceipt(receipt: DesignReceipt, json = false): string {
  return json ? `${JSON.stringify(receipt, null, 2)}\n` : `${humanReceipt(receipt)}\n`;
}
