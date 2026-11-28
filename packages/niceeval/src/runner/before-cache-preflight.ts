import { Effect, Option } from "effect";
import { sandboxActionStateCovers } from "../sandbox/action.ts";
import { sandboxProviderBindingOf } from "../sandbox/layer.ts";
import { cacheableAgentInstallers } from "../sandbox/remote-snapshot/agent-derived.ts";
import { userDatabaseHost } from "../user-database/index.ts";
import { continuousEligibleActions } from "./before-cache-preparation.ts";
import type { ProjectTargetPlan } from "./fingerprint.ts";
import type { ExecutionReusePlan } from "./reuse-plan.ts";
import { runPairKey, type PreparedRunPair } from "./sandbox-selection.ts";

function requiresBeforeCacheLedger(pair: PreparedRunPair, stateBound: boolean): boolean {
  const { plan, run } = pair;
  if (run.sandboxBeforeCache === "bypass" || plan._tag !== "Sandbox") return false;
  const binding = Option.getOrUndefined(sandboxProviderBindingOf(plan.providerPlan));
  const support = binding?.beforeCache;
  if (support === undefined || support._tag === "Unsupported") return false;
  if (support._tag === "AttemptCaptured") {
    const first = plan.pair.before[0];
    return (
      support.requiresUserDatabase === true &&
      !stateBound &&
      plan.pair.setupHooks.length === 0 &&
      plan.pair.pluginLifecycles.length === 0 &&
      first?.kind === "action" &&
      sandboxActionStateCovers(support.coverage, first.data.plan.state)
    );
  }
  if (support.preparer.requiresUserDatabase !== true || plan.providerPlan.build.buildKeys.length > 0) return false;
  if (continuousEligibleActions(plan, support.coverage).length > 0) return true;
  const agent = run.agent;
  return (
    support.preparer.supportsAgentDerived &&
    agent?.kind === "sandbox" &&
    cacheableAgentInstallers(agent.install, agent.installers) !== undefined
  );
}

export function checkBeforeCacheUserDatabase(
  target: Pick<ProjectTargetPlan, "preparedPairsByKey" | "stateByPair">,
  reusePlan: ExecutionReusePlan,
) {
  const needsLedger = reusePlan.gaps.some((slot) => {
    const key = runPairKey(slot.experimentId, slot.evalId);
    const pair = target.preparedPairsByKey.get(key);
    return pair !== undefined && requiresBeforeCacheLedger(pair, target.stateByPair.has(key));
  });
  return needsLedger ? userDatabaseHost.checkFormat() : Effect.void;
}
