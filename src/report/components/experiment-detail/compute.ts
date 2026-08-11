// Experiment 详情组合件的计算函数(docs/feature/reports/README.md)。
// experimentDetailsData(sample) 把收窄到单个 experiment 的 Sample 折成六区块共享的一份普通值;
// 六区块只投影这份结果,不各自取数(与 attempt-detail/compute.ts 同一条纪律)。

import type { Sample } from "../../../record/types.ts";
import type { ExperimentDetailsData } from "../../model/types.ts";
import { experimentListData } from "../entity-lists/compute.ts";
import { runNoticesContent, sampleNoticesContent } from "../site-components/projections.ts";

/**
 * 收窄结果必须恰好包含一个实验:零个或多个都按完整用户反馈报错,点名收窄到了哪些
 * experiment——静默取第一个会把调用方的收窄 bug 藏成错数据。
 */
export async function experimentDetailsData(sample: Sample): Promise<ExperimentDetailsData> {
  const [items, notices, diagnostics] = await Promise.all([
    experimentListData(sample),
    sampleNoticesContent(sample),
    runNoticesContent(sample),
  ]);
  if (items.length === 0) {
    throw new Error(
      "ExperimentDetails needs a scope narrowed to exactly one experiment, but the given input contains none. " +
        'Narrow it first, e.g. sample.scope({ experiments: ["agents/codex"] }).',
    );
  }
  if (items.length > 1) {
    throw new Error(
      `ExperimentDetails needs a scope narrowed to exactly one experiment, but the given input narrowed to ${items.length}: ` +
        `${items.map((item) => item.experimentId).join(", ")}. ` +
        'Narrow it further, e.g. sample.scope({ experiments: ["agents/codex"] }).',
    );
  }
  const experiment = items[0]!;
  return {
    experiment,
    catchUpCommand: experiment.missing.length > 0 ? `niceeval exp ${experiment.experimentId}` : null,
    notices,
    diagnostics,
  };
}
