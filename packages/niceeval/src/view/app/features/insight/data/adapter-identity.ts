import type { AdapterIdentity } from "../../../../../record/model/run-context.ts";

export interface ClosedAdapterIdentity {
  readonly name: string;
  readonly contract: string;
  readonly behaviorRevision: string | undefined;
}

export function closeAdapterIdentity(value: AdapterIdentity | undefined): ClosedAdapterIdentity | undefined {
  if (value === null || value === undefined) return undefined;
  return { name: value.name, contract: value.contract, behaviorRevision: value.behaviorRevision ?? undefined };
}
