import { digestOf } from "../sandbox/identity.ts";
import type { StateLineage } from "./protocol.ts";

export function stateLineageId(lineage: StateLineage): string {
  return digestOf({
    name: lineage.name,
    version: lineage.version,
    cohort: lineage.cohort,
    experimentId: lineage.experimentId,
    evalGroupId: lineage.evalGroupId,
  });
}

export function stateLeaseKey(lineage: StateLineage): string {
  return `state/${stateLineageId(lineage)}`;
}
