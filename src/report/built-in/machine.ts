/**
 * Built-in Reports opt into Host-owned machine output with a portable,
 * data-only descriptor.  The descriptor is installed on the mutable
 * definition input before `defineReport()` freezes and normalizes it; the
 * definition module validates and copies only its versioned producer id.
 *
 * This module intentionally has no producer callback or registry. The Host
 * maps these ids to its own registry.
 */

import {
  defineReport,
  type ReportDefinition,
} from "../definition/report.ts";
import {
  attachBuiltInMachineDescriptor,
  defineBuiltInMachineDescriptor,
} from "../execution/machine.ts";

/** Stable names consumed by the Host-owned built-in machine registry. */
export const builtInMachineProducerIds = Object.freeze({
  defaultOverview: "niceeval.report.default-overview@v2",
  runMembershipOverview: "niceeval.report.run-membership-overview@v2",
  attemptOverview: "niceeval.report.attempt-overview@v2",
  executionEvidence: "niceeval.report.execution-evidence@v2",
  timingEvidence: "niceeval.report.timing-evidence@v2",
  sourceEvidence: "niceeval.report.source-evidence@v2",
  sandboxHistory: "niceeval.report.sandbox-history@v2",
  standard: "niceeval.report.standard@v2",
  classicOverview: "niceeval.report.classic-overview@v2",
} as const);

export type BuiltInMachineProducerId =
  (typeof builtInMachineProducerIds)[keyof typeof builtInMachineProducerIds];

/**
 * Creates a built-in Report without ever mutating the frozen Report returned
 * by `defineReport()`.  Repeated installed copies recognize this descriptor
 * through the two versioned `Symbol.for` keys rather than object identity.
 */
export function defineBuiltInReport(
  producerId: BuiltInMachineProducerId,
  definition: object,
): ReportDefinition {
  const input = attachBuiltInMachineDescriptor(
    { ...definition },
    defineBuiltInMachineDescriptor(producerId),
  );
  // The public overload deliberately preserves each Page's Input inference.
  // This internal bridge merely lets this factory accept every valid built-in
  // Page shape; defineReport still validates the complete declaration at run
  // time and copies the descriptor before freezing its output.
  return (defineReport as unknown as (value: object) => ReportDefinition)(input);
}
