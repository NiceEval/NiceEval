import type { JsonValue } from "../shared/types.ts";
import {
  mergeSandboxActionState,
  sandboxActionStateCovers,
  sandboxStepExecutionOf,
  type SandboxActionState,
} from "../sandbox/action.ts";
import { digestOf } from "../sandbox/identity.ts";
import type { BeforeCacheEligibility } from "../sandbox/backend.ts";
import { beforeCacheReplacementScope } from "../sandbox/before-cache-replacement.ts";
import { sandboxTemplateCommandPlanLocator } from "../sandbox/layer.ts";
import type { LinkedRunPlan } from "../sandbox/plan.ts";
import { beforeCacheActionDeclaration, type PlannedBeforeCacheAction } from "./before-cache-plan.ts";

export interface BeforeCachePosition {
  readonly scope: string;
  readonly content: string;
  readonly owner: string;
  readonly experimentId: string;
  readonly actionId: string;
}

export function* declaredBeforeCachePositions(plans: readonly LinkedRunPlan[]): Generator<BeforeCachePosition> {
  for (const plan of plans) {
    if (plan._tag !== "Sandbox") continue;
    const support = plan.providerPlan.capabilities.beforeCache;
    if (support._tag !== "AttemptCaptured") continue;
    if (plan.pair.setupHooks.length > 0 || plan.pair.teardownHooks.length > 0 || plan.pair.pluginLifecycles.length > 0)
      continue;
    const locator = sandboxTemplateCommandPlanLocator(plan.pair.template);
    const image =
      plan.providerPlan.provider === "docker" && support.coverage === "all" && locator._tag === "Exact"
        ? locator.fields.find((field) => field.name === "image")?.value
        : undefined;
    const base = image === undefined ? plan.providerPlan.identity : { image };
    let state: SandboxActionState | undefined;
    const chain: string[] = [];
    const declarations: JsonValue[] = [];
    for (const entry of plan.pair.before) {
      if (entry.kind !== "action" || entry.owner.kind === "agent") break;
      if (
        entry.data.steps.some((step) => {
          const execution = sandboxStepExecutionOf(step);
          return (
            execution.kind === "exec" && (execution.input.stdin !== undefined || execution.input.env !== undefined)
          );
        })
      )
        break;
      state = mergeSandboxActionState(state, entry.data.plan.state);
      if (!sandboxActionStateCovers(support.coverage, state)) break;
      chain.push(entry.id);
      const owner = `${entry.owner.kind}:${entry.owner.id}`;
      const scope = digestOf({
        provider: plan.providerPlan.provider,
        base,
        positions: chain,
        declaringOwner: owner,
      });
      declarations.push(beforeCacheActionDeclaration(entry, state));
      yield {
        scope,
        content: digestOf(declarations),
        owner,
        experimentId: plan.pair.experimentId,
        actionId: entry.id,
      };
    }
  }
}

export function beforeCacheReplacementWarnings(candidates: Iterable<BeforeCachePosition>) {
  const positions = new Map<string, Map<string, BeforeCachePosition>>();
  for (const candidate of candidates) {
    let variants = positions.get(candidate.scope);
    if (variants === undefined) {
      variants = new Map();
      positions.set(candidate.scope, variants);
    }
    variants.set(JSON.stringify([candidate.content, candidate.experimentId]), candidate);
  }
  return [...positions].flatMap(([scope, variants]) => {
    const contents = new Set([...variants.values()].map((variant) => variant.content));
    if (contents.size < 2) return [];
    const declarations = [...variants.values()];
    const actionId = declarations[0]!.actionId;
    const owners = [...new Set(declarations.map((item) => item.owner))].sort();
    return [
      {
        key: `before-cache-replacement-conflict:${scope}`,
        experimentIds: [...new Set(declarations.map((item) => item.experimentId))],
        message: `Before action ${JSON.stringify(actionId)} has different content at the same cache replacement position (${owners.join(", ")}). These declarations replace each other's cached snapshots. Use different action ids to keep them independently cached.`,
      },
    ];
  });
}

export type ObserveAttemptBeforeCache = (
  plan: Extract<LinkedRunPlan, { readonly _tag: "Sandbox" }>,
  scope: NonNullable<Extract<BeforeCacheEligibility, { readonly _tag: "Eligible" }>["replacementScope"]>,
  actions: readonly PlannedBeforeCacheAction[],
) => void;

export function observeAttemptBeforeCacheConflicts(
  onWarning: (warning: ReturnType<typeof beforeCacheReplacementWarnings>[number]) => void,
): ObserveAttemptBeforeCache {
  const positions = new Map<
    string,
    { readonly actual: BeforeCachePosition; readonly declared: BeforeCachePosition | undefined; warned: boolean }
  >();
  const declarations = new WeakMap<LinkedRunPlan, readonly BeforeCachePosition[]>();
  return (plan, scope, actions) => {
    let declaredPositions = declarations.get(plan);
    if (declaredPositions === undefined) {
      declaredPositions = [...declaredBeforeCachePositions([plan])];
      declarations.set(plan, declaredPositions);
    }
    for (const [index, action] of actions.entries()) {
      const actual: BeforeCachePosition = {
        scope: beforeCacheReplacementScope(scope, action),
        content: action.key,
        owner: action.declaringOwner,
        experimentId: plan.pair.experimentId,
        actionId: action.entry.id,
      };
      const declared = declaredPositions[index];
      const previous = positions.get(actual.scope);
      if (previous === undefined) {
        positions.set(actual.scope, { actual, declared, warned: false });
        continue;
      }
      if (previous.warned || previous.actual.content === actual.content) continue;
      previous.warned = true;
      // Planning has already reported this pair when the declarations alone disagree.
      if (
        declared !== undefined &&
        previous.declared?.scope === declared.scope &&
        previous.declared.content !== declared.content
      )
        continue;
      for (const warning of beforeCacheReplacementWarnings([previous.actual, actual])) onWarning(warning);
    }
  };
}
