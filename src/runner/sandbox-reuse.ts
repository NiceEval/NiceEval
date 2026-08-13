// Reusable Sandbox pool identity is a pure planning fact shared by runtime,
// command-plan projection, and Plugin resource cohorts. Keep eligibility and
// scope selection here so those consumers cannot silently group different pairs.

import { digestOf } from "../sandbox/identity.ts";
import type { LinkedRunPlan } from "../sandbox/plan.ts";
import { agentInstallPlansForRun } from "./config-identity.ts";
import type { AgentRun } from "./types.ts";

export type SandboxReusePoolScope =
  | { readonly kind: "shared" }
  | { readonly kind: "eval"; readonly evalId: string }
  | { readonly kind: "eval-group"; readonly evalGroupId: string };

export interface SandboxReusePoolDescriptor {
  /** Runtime map key and opaque CommandPlan pool-specification identity. */
  readonly key: string;
  readonly scope: SandboxReusePoolScope;
}

export interface SandboxReusePoolDescriptorInput {
  readonly run: AgentRun;
  readonly evalId: string;
  readonly evalGroupId?: string;
  readonly plan: LinkedRunPlan;
}

/**
 * Describe a physical reuse pool when this pair is eligible for one.
 *
 * The descriptor intentionally excludes capacity and per-Attempt preparation:
 * they affect leasing and work performed after a lease, not which physical
 * instances may satisfy it. AgentRun remains the outer runtime isolation key.
 */
export function sandboxReusePoolDescriptor(
  input: SandboxReusePoolDescriptorInput,
): SandboxReusePoolDescriptor | undefined {
  if (input.run.agent.kind !== "sandbox" || input.plan._tag !== "Sandbox") return undefined;
  let scope: SandboxReusePoolScope;
  if (input.evalGroupId !== undefined) {
    scope = { kind: "eval-group", evalGroupId: input.evalGroupId };
  } else {
    if (input.run.sandboxReuse !== true) return undefined;
    scope = input.plan.pair.hasEvalLifecycleHooks
      ? { kind: "eval", evalId: input.evalId }
      : { kind: "shared" };
  }
  const digest = digestOf({
    version: 1,
    providerPlan: input.plan.providerPlan.identity,
    agentInstalls: [...agentInstallPlansForRun(input.run)],
    scope,
  });
  return Object.freeze({
    key: `sandbox-reuse-pool:v1:${digest}`,
    scope: Object.freeze(scope),
  });
}
