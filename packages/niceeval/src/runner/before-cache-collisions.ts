import type { JsonValue } from "../shared/types.ts";
import { mergeSandboxActionState, sandboxActionStateCovers, sandboxStepExecutionOf, type SandboxActionState } from "../sandbox/action.ts";
import { digestOf } from "../sandbox/identity.ts";
import type { LinkedRunPlan } from "../sandbox/plan.ts";
import { beforeCacheActionDeclaration } from "./before-cache-plan.ts";

/** Advisory planning only: compare declared positions before allocating instances. */
export function beforeCacheReplacementWarnings(plans: readonly LinkedRunPlan[], resolvedScopes: ReadonlyMap<LinkedRunPlan, JsonValue> = new Map()) {
  const positions = new Map<string, Map<string, { readonly content: string; readonly owner: string; readonly experimentId: string; readonly actionId: string }>>();
  for (const plan of plans) {
    if (plan._tag !== "Sandbox") continue;
    const support = plan.providerPlan.capabilities.beforeCache;
    if (support._tag === "Unsupported") continue;
    if (plan.pair.setupHooks.length > 0 || plan.pair.teardownHooks.length > 0 || plan.pair.pluginLifecycles.length > 0) continue;
    const resolvedScope = resolvedScopes.get(plan);
    if (support._tag === "RunPrepared" && resolvedScope === undefined) continue;
    let state: SandboxActionState | undefined;
    const chain: string[] = [];
    for (const entry of plan.pair.before) {
      if (entry.kind !== "action" || entry.owner.kind === "agent") break;
      if (entry.data.steps.some((step) => {
        const execution = sandboxStepExecutionOf(step);
        return execution.kind === "exec" && (execution.input.stdin !== undefined || execution.input.env !== undefined);
      })) break;
      state = mergeSandboxActionState(state, entry.data.plan.state);
      if (!sandboxActionStateCovers(support.coverage, state)) break;
      chain.push(entry.id);
      const scope = digestOf({ provider: plan.providerPlan.provider, base: resolvedScope ?? plan.providerPlan.identity, positions: chain });
      let variants = positions.get(scope);
      if (variants === undefined) { variants = new Map(); positions.set(scope, variants); }
      // A changed ancestor is reported at its own position, without repeating
      // the same conflict at every descendant.
      const content = digestOf(beforeCacheActionDeclaration(entry, state));
      const owner = `${entry.owner.kind}:${entry.owner.id}`;
      variants.set(JSON.stringify([content, owner, plan.pair.experimentId]), { content, owner, experimentId: plan.pair.experimentId, actionId: entry.id });
    }
  }
  return [...positions].flatMap(([scope, variants]) => {
    const contents = new Set([...variants.values()].map((variant) => variant.content));
    if (contents.size < 2) return [];
    const declarations = [...variants.values()];
    const actionId = declarations[0]!.actionId;
    const owners = [...new Set(declarations.map((item) => item.owner))].sort();
    return [{
      key: `before-cache-replacement-conflict:${scope}`,
      experimentIds: [...new Set(declarations.map((item) => item.experimentId))],
      message: `Before action ${JSON.stringify(actionId)} has different content at the same cache replacement position (${owners.join(", ")}). These declarations replace each other's cached snapshots. Use different action ids to keep them independently cached.`,
    }];
  });
}
