import type { BeforeCacheStep } from "./backend.ts";
import { digestOf } from "./identity.ts";

/** Replacement lineage is independent of content keys and consumer identity. */
export function beforeCacheReplacementScope(
  target: { readonly provider: string; readonly executionDomainId: string; readonly baseReference: string },
  step: Pick<BeforeCacheStep, "positions" | "declaringOwner">,
): string {
  return digestOf({
    domain: "niceeval.before-cache-replacement",
    ...target,
    positions: [...step.positions],
    declaringOwner: step.declaringOwner,
  });
}
