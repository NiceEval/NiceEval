// Reusable Sandbox pool identity is a pure planning fact shared by runtime,
// command-plan projection, and Plugin resource cohorts. Keep eligibility and
// scope selection here so those consumers cannot silently group different pairs.

import { digestOf } from "../sandbox/identity.ts";
import { sandboxPhysicalLifecycleIdentity } from "../sandbox/link.ts";
import type { LinkedRunPlan } from "../sandbox/plan.ts";
import type { JsonValue } from "../shared/types.ts";
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
  /** Internal structured comparison input; never expand it through the public command-plan lane id. */
  readonly identity: SandboxReusePoolIdentity;
}

export interface SandboxReusePoolIdentity {
  readonly version: 2;
  readonly providerPlan: JsonValue;
  readonly agentInstalls: JsonValue[];
  readonly physicalLifecycle: JsonValue;
  readonly scope: SandboxReusePoolScope;
}

export type SandboxReusePoolIdentityFacet =
  | "provider plan"
  | "agent install"
  | "physical lifecycle";

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
    scope = input.plan.pair.hasEvalPhysicalLifecycle
      ? { kind: "eval", evalId: input.evalId }
      : { kind: "shared" };
  }
  const identity = Object.freeze({
    version: 2 as const,
    providerPlan: input.plan.providerPlan.identity,
    agentInstalls: [...agentInstallPlansForRun(input.run)],
    physicalLifecycle: sandboxPhysicalLifecycleIdentity(input.plan.pair),
    scope: Object.freeze(scope),
  });
  const digest = digestOf(identity);
  return Object.freeze({
    key: `sandbox-reuse-pool:v2:${digest}`,
    scope: identity.scope,
    identity,
  });
}

/** Explain a failed cohort comparison without duplicating lifecycle projection logic. */
export function sandboxReusePoolIdentityDifferences(
  left: SandboxReusePoolIdentity,
  right: SandboxReusePoolIdentity,
): readonly SandboxReusePoolIdentityFacet[] {
  const differences: SandboxReusePoolIdentityFacet[] = [];
  if (digestOf(left.providerPlan) !== digestOf(right.providerPlan)) differences.push("provider plan");
  if (digestOf(left.agentInstalls) !== digestOf(right.agentInstalls)) differences.push("agent install");
  if (digestOf(left.physicalLifecycle) !== digestOf(right.physicalLifecycle)) differences.push("physical lifecycle");
  return Object.freeze(differences);
}
