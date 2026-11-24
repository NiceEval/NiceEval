import { pluginInstanceDataOf } from "../plugin/contracts.ts";
import type { PreparedRunPair } from "../runner/sandbox-selection.ts";
import type { AgentRun, DiscoveredEval } from "../runner/types.ts";
import { stateBindingData, StateDefinitionError, type StateBindingData } from "./definition.ts";
import { stateLeaseKey } from "./identity.ts";
import { compareStateLineage, type StateLineage } from "./protocol.ts";

export interface PlannedStateBinding {
  readonly definition: StateBindingData;
  readonly lineage: StateLineage;
}

export interface PlannedGroupState {
  readonly bindings: readonly [PlannedStateBinding, ...PlannedStateBinding[]];
}

export function stateCondition(binding: PlannedStateBinding) {
  const { name, version, cohort } = binding.lineage;
  const { paths, initializeIdentity } = binding.definition;
  return {
    name,
    version,
    cohort,
    paths: [...paths],
    ...(initializeIdentity === undefined ? {} : { initialize: initializeIdentity }),
  };
}

export function pathsOverlap(a: string, b: string): boolean {
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

export function stateBindingsFor(run: AgentRun, evalDef: DiscoveredEval) {
  return [
    ...(run.state ?? []),
    ...[...run.plugins, ...(evalDef.evalGroup?.plugins ?? [])].flatMap(
      (plugin) => pluginInstanceDataOf(plugin).state ?? [],
    ),
  ];
}

export function planGroupState(pairs: readonly PreparedRunPair[]) {
  const byPair = new Map<string, PlannedGroupState>();
  const byExperiment = new Map<string, Set<string>>();
  const definitions = new Map<string, string>();
  const groups = new Map<string, string>();
  for (const { evalDef, key, plan, run } of pairs) {
    const group = evalDef.evalGroup;
    const bindings = stateBindingsFor(run, evalDef).map(stateBindingData);
    const first = bindings[0];
    if (first !== undefined && group === undefined) {
      throw new StateDefinitionError(
        "state-requires-eval-group",
        `State on ${run.experimentId} requires ${evalDef.id} to belong to an Eval Group.`,
      );
    }
    if (group === undefined) continue;
    const seen = new Set<string>();
    const paths: string[] = [];
    const ordered = bindings
      .map((definition): PlannedStateBinding => {
        const { name, version, cohort, initializeIdentity } = definition;
        const shape = JSON.stringify([version, definition.paths, initializeIdentity]);
        const previous = definitions.get(name);
        if (seen.has(name) || (previous !== undefined && previous !== shape)) {
          throw new StateDefinitionError(
            "state-duplicate",
            `State ${name} is declared twice or has inconsistent definitions.`,
          );
        }
        for (const path of definition.paths) {
          if (paths.some((other) => pathsOverlap(other, path)))
            throw new StateDefinitionError(
              "state-path-conflict",
              `State paths overlap in ${run.experimentId} / ${group.id}.`,
            );
          paths.push(path);
        }
        seen.add(name);
        definitions.set(name, shape);
        return {
          definition,
          lineage: { name, version, cohort, experimentId: run.experimentId, evalGroupId: group.id },
        };
      })
      .sort((left, right) => compareStateLineage(left.lineage, right.lineage));
    const shape = JSON.stringify(ordered.map(stateCondition));
    const groupKey = JSON.stringify([run.experimentId, group.id]);
    const previous = groups.get(groupKey);
    if (previous !== undefined && previous !== shape) {
      throw new StateDefinitionError("eval-group-incompatible", `State bindings differ across ${group.id} members.`);
    }
    groups.set(groupKey, shape);
    const head = ordered[0];
    if (head === undefined) continue;
    if (plan._tag !== "Sandbox" || plan.providerPlan.capabilities.state === undefined) {
      throw new StateDefinitionError(
        "state-provider-unsupported",
        `The selected Sandbox provider cannot safely restore and save State for ${run.experimentId} / ${group.id}.`,
      );
    }
    const { workdir } = plan.providerPlan.capabilities.state;
    const overlap =
      workdir === undefined ? undefined : paths.find((path) => path.startsWith("/") && pathsOverlap(path, workdir));
    if (overlap !== undefined) {
      throw new StateDefinitionError(
        "state-path-in-workdir",
        `State path ${JSON.stringify(overlap)} overlaps the Sandbox workdir ${JSON.stringify(workdir)}.`,
      );
    }
    byPair.set(key, { bindings: [head, ...ordered.slice(1)] });
    let keys = byExperiment.get(run.experimentId);
    if (keys === undefined) {
      keys = new Set();
      byExperiment.set(run.experimentId, keys);
    }
    for (const { lineage } of ordered) keys.add(stateLeaseKey(lineage));
  }
  return { byPair, byExperiment };
}
