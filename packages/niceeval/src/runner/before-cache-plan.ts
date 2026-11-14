import { randomUUID } from "node:crypto";
import type { JsonValue } from "../shared/types.ts";
import {
  type BeforeCacheEligibility,
  type BeforeCacheDeclaration,
  type BeforeCacheStep,
} from "../sandbox/backend.ts";
import { mergeSandboxActionState, type SandboxActionState } from "../sandbox/action.ts";
import { digestOf } from "../sandbox/identity.ts";
import type { ScheduledSandboxBefore } from "../sandbox/link.ts";
import type { LinkedRunPlan } from "../sandbox/plan.ts";

/** Consumer attribution is never part of an artifact's content identity. */
export function beforeCacheAttribution(entry: ScheduledSandboxBefore) {
  const owner = Object.freeze({ kind: entry.owner.kind, id: entry.owner.id });
  return Object.freeze({
    owner,
    declarationOrder: Object.freeze({ owner, ordinal: entry.ordinal }),
    executionOrder: entry.executionOrder,
    changeFrequency: entry.metadata.changeFrequency,
    schedulingReason: entry.schedulingReason,
    dependencies: entry.dependencies,
  });
}

/** The ordered capture facts shared by runtime identity and the dry/debug plan. */
export function beforeCacheActionDeclaration(
  entry: Extract<ScheduledSandboxBefore, { readonly kind: "action" }>,
  cumulativeState: SandboxActionState,
) {
  return Object.freeze({
    capabilities: {
      requires: [...entry.metadata.requires],
      provides: [...entry.metadata.provides],
    },
    action: {
      id: entry.data.plan.id,
      family: entry.data.plan.family,
      declaredState: entry.data.plan.state,
      cumulativeState,
      input: entry.data.plan.input,
      fingerprint: { ...entry.data.plan.fingerprint },
      steps: entry.data.plan.steps.map((step) => {
        if (step.kind === "exec") {
          const { args, envKeys, ...fields } = step;
          return { ...fields, args: [...args], ...(envKeys === undefined ? {} : { envKeys: [...envKeys] }) };
        }
        if (step.kind === "checkoutGit") {
          const { sparse, ...fields } = step;
          return { ...fields, ...(sparse === undefined ? {} : {
            sparse: { include: [...sparse.include], exclude: [...sparse.exclude] },
          }) };
        }
        return { ...step };
      }),
    },
  });
}

export interface PlannedBeforeCacheAction {
  readonly entry: Extract<ScheduledSandboxBefore, { readonly kind: "action" }>;
  readonly key: string;
  readonly declaration: BeforeCacheDeclaration;
  readonly positions: readonly string[];
  readonly declaringOwner: string;
  /** Current consumer's declarations, aligned with the prefix's action order. */
  readonly attributions: readonly ReturnType<typeof beforeCacheAttribution>[];
}

/**
 * The one provider-neutral BeforeCache key planner. CaseKey, BuildKey and an
 * occurrence cohort deliberately stay out of this identity: the exact Base,
 * provider preparation identity and ordered action content are sufficient.
 */
export function plannedBeforeCacheActions(
  plan: Extract<LinkedRunPlan, { readonly _tag: "Sandbox" }>,
  entries: readonly Extract<ScheduledSandboxBefore, { readonly kind: "action" }>[],
  eligibility: Extract<BeforeCacheEligibility, { readonly _tag: "Eligible" }>,
): readonly PlannedBeforeCacheAction[] {
  const baseIdentity = eligibility.baseIdentity;
  const keyScope = eligibility.keyScope;
  const keyScopeIdentity: JsonValue = { ...keyScope };
  const provider = plan.providerPlan;
  const targetIdentity: JsonValue = {
    source: provider.target.source,
    platform: { ...provider.target.platform },
  };
  const revisions = Object.freeze({
    format: keyScope.cacheFormat,
  });
  let parentKey = `base:${digestOf({
    domain: "niceeval.before-cache-key",
    baseIdentity,
    provider: {
      id: provider.provider,
      plannerRevision: provider.plannerRevision,
    },
    target: targetIdentity,
    revisions,
    preparationIdentity: keyScopeIdentity,
  })}`;
  const planned: PlannedBeforeCacheAction[] = [];
  const actionDeclarations: JsonValue[] = [];
  const positions: string[] = [];
  const attributions: ReturnType<typeof beforeCacheAttribution>[] = [];
  let cumulativeState: SandboxActionState | undefined;
  for (const entry of entries) {
    cumulativeState = mergeSandboxActionState(cumulativeState, entry.data.plan.state);
    actionDeclarations.push(beforeCacheActionDeclaration(entry, cumulativeState));
    attributions.push(beforeCacheAttribution(entry));
    positions.push(entry.data.plan.id);
    const declarationMetadata: JsonValue = Object.freeze({
      parentKey,
      baseIdentity,
      provider: {
        id: provider.provider,
        plannerRevision: provider.plannerRevision,
      },
      actionDeclarations: [...actionDeclarations],
      requiredState: cumulativeState,
      target: targetIdentity,
      revisions,
      preparationIdentity: keyScopeIdentity,
    });
    const key = `prefix:${digestOf(declarationMetadata)}`;
    const declaration: BeforeCacheDeclaration = Object.freeze({
      baseIdentity,
      beforeCacheKey: key,
      declarationDigest: `sha256:${digestOf(declarationMetadata)}`,
      requiredState: cumulativeState,
      cacheFormat: keyScope.cacheFormat,
      changeFrequency: entry.metadata.changeFrequency.value,
      declarationMetadata,
    });
    planned.push(Object.freeze({ entry, key, declaration, positions: Object.freeze([...positions]), declaringOwner: `${entry.owner.kind}:${entry.owner.id}`, attributions: Object.freeze([...attributions]) }));
    parentKey = key;
  }
  return Object.freeze(planned);
}

export function beforeCacheStep(
  planned: Pick<PlannedBeforeCacheAction, "declaration" | "positions" | "declaringOwner">,
  knownSensitiveValues?: readonly string[],
): BeforeCacheStep {
  return Object.freeze({
    operationId: `before-cache-${randomUUID()}`,
    declaration: planned.declaration,
    positions: planned.positions,
    declaringOwner: planned.declaringOwner,
    ...(knownSensitiveValues === undefined || knownSensitiveValues.length === 0
      ? {}
      : { knownSensitiveValues: Object.freeze([...knownSensitiveValues]) }),
  });
}
