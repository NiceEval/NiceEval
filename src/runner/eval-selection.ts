// 纯选题边界:发现结果 → EvalDescriptor 投影 → 用户谓词求值 → selectedEvalIds。
// CLI 在构造每个 AgentRun 前对候选 eval 各调用一次谓词并把结果落进这里;下游(dry-run、
// sandbox 查表、fingerprint/carry、attempt 展开、hook ctx、快照)只消费返回的
// selectedEvalIds,不重新调用用户谓词(见 docs/feature/experiments/library.md「evals」)。

import { evalPrefixPredicate } from "../shared/aggregate.ts";
import type { AgentRun, DiscoveredEval, EvalDescriptor, ExperimentAuthorFields } from "./types.ts";

/** `DiscoveredEval` → 用户谓词可见的显式白名单投影;不透传内部路径/执行字段。 */
export function evalDescriptorOf(evalDef: DiscoveredEval): EvalDescriptor {
  return Object.freeze({
    id: evalDef.id,
    ...(evalDef.description !== undefined ? { description: evalDef.description } : {}),
    tags: Object.freeze([...(evalDef.tags ?? [])]),
    evaluationKind: evalDef.evaluationKind ?? "pass",
    ...(Object.keys(evalDef.metadata ?? {}).length > 0
      ? { metadata: Object.freeze({ ...evalDef.metadata }) }
      : {}),
  });
}

export interface ResolveExperimentEvalsInput {
  experimentId: string;
  selector: ExperimentAuthorFields["evals"];
  cliPatterns: readonly string[];
  evals: readonly DiscoveredEval[];
}

export interface ResolveExperimentEvalsResult {
  selectedEvals: readonly DiscoveredEval[];
  selectedEvalIds: readonly string[];
  /**
   * 只过了实验自身 `evals` 选择器、还没被 CLI 尾随前缀收窄的那一集——即这个实验的**发现集**。
   * CLI 拿它判定「某个尾随前缀在选中实验里匹配 0 条」:交集为空时两种原因(前缀写错 / 实验本来
   * 就没选中任何 eval)要报不同的错,只看交集分辨不出来。谓词仍然只求值一次。
   */
  selectorEvals: readonly DiscoveredEval[];
}

/**
 * 对某个 experiment 的候选 eval 集合各求值谓词一次,与 CLI 追加的位置参数前缀取交集。
 * 返回顺序 = discovery 稳定顺序,id 去重——这是 dry-run、attempt 派发顺序与落盘
 * `selectedEvalIds` 的共同来源(见 docs/feature/eval/README.md「路径即身份」)。
 */
export function resolveExperimentEvals(input: ResolveExperimentEvalsInput): ResolveExperimentEvalsResult {
  const { experimentId, selector, cliPatterns, evals } = input;
  const patternFilter = evalPrefixPredicate(cliPatterns.length > 0 ? [...cliPatterns] : undefined);

  let selectorFilter: (evalDef: DiscoveredEval) => boolean;
  if (selector === undefined || selector === "*") {
    selectorFilter = () => true;
  } else if (typeof selector === "function") {
    const predicate = selector;
    selectorFilter = (evalDef) => {
      let result: unknown;
      try {
        result = predicate(evalDescriptorOf(evalDef));
      } catch (e) {
        throw new Error(
          `experiment "${experimentId}" evals predicate threw for eval "${evalDef.id}": ` +
            `${e instanceof Error ? e.message : String(e)}`,
          { cause: e },
        );
      }
      if (result instanceof Promise) {
        throw new Error(
          `experiment "${experimentId}" evals predicate returned a Promise for eval "${evalDef.id}"; ` +
            "the predicate must be synchronous — do not await inside evals().",
        );
      }
      if (typeof result !== "boolean") {
        throw new Error(
          `experiment "${experimentId}" evals predicate returned ${JSON.stringify(result)} (not a boolean) ` +
            `for eval "${evalDef.id}".`,
        );
      }
      return result;
    };
  } else {
    const arrayFilter = evalPrefixPredicate([...selector]);
    selectorFilter = (evalDef) => arrayFilter(evalDef.id);
  }

  const seen = new Set<string>();
  const selectedEvals: DiscoveredEval[] = [];
  const selectorEvals: DiscoveredEval[] = [];
  for (const evalDef of evals) {
    if (seen.has(evalDef.id)) continue;
    if (!selectorFilter(evalDef)) continue;
    seen.add(evalDef.id);
    selectorEvals.push(evalDef);
    if (!patternFilter(evalDef.id)) continue;
    selectedEvals.push(evalDef);
  }
  return { selectedEvals, selectedEvalIds: selectedEvals.map((e) => e.id), selectorEvals };
}

/** `resolveExperimentEvals` 选中的 eval 按题型分桶后的 id 列表(见 splitByEvaluationKind)。 */
export interface EvaluationKindSplit {
  pass: string[];
  points: string[];
}

/**
 * 按题型(`EvalDescriptor.evaluationKind`)把选中的 eval 分桶。混型是合法运行形状；报告按桶分别
 * 计算通过率与总分，不把两者相加。
 */
export function splitByEvaluationKind(selectedEvals: readonly DiscoveredEval[]): EvaluationKindSplit {
  const pass: string[] = [];
  const points: string[] = [];
  for (const evalDef of selectedEvals) {
    (evalDef.evaluationKind === "points" ? points : pass).push(evalDef.id);
  }
  return { pass, points };
}

/** 所有消费者按已解析的 `selectedEvalIds` 取 eval;不持有、不调用用户谓词。 */
export function selectedEvalsForRun(
  all: readonly DiscoveredEval[],
  run: Pick<AgentRun, "selectedEvalIds">,
): DiscoveredEval[] {
  const ids = new Set(run.selectedEvalIds);
  return all.filter((e) => ids.has(e.id));
}
