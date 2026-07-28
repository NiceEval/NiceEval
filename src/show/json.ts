// niceeval show --json —— 信封与通用 attempt 投影(契约:docs/feature/reports/show/json.md)。
// `data` 字段本身不是第二套形状:逐 view 指向对应报告组件的 `*Data` 产物,字段单源住在各组件
// 分篇(docs/feature/reports/architecture.md「show 的切片是组件选择」)。本文件只装配信封、
// 通用 attempt 投影与 stdout 单文档序列化,不重复声明任何组件的字段形状。

import type { AttemptHandle } from "../record/index.ts";
import type { EvalResult } from "../types.ts";

/** 信封 `view` 的穷尽集合,与 docs/feature/reports/show/json.md「data:按 view 找组件声明」的表逐行对应。 */
export type ShowJsonView =
  | "leaderboard"
  | "compare"
  | "attempt"
  | "source"
  | "execution"
  | "timing"
  | "usage"
  | "diff"
  | "history"
  | "stats";

/** `--json` 的顶层信封(docs/feature/reports/show/json.md「信封」)。 */
export interface ShowJson {
  format: "niceeval.show";
  /** 破坏性形状变更时递增;新增可选字段不递增,消费方忽略未知字段。 */
  schemaVersion: 1;
  view: ShowJsonView;
  /** 本次调用解析后的范围回显。 */
  scope: {
    resultsRoot: string;
    evalPrefix?: string;
    /** 解析后的 experiment id 全集;对照视图下顺序即条件顺序,首个是基准。 */
    experiments: string[];
    fresh: boolean;
  };
  data: unknown;
}

/**
 * attempt 的通用投影(docs/feature/reports/show/json.md「通用 attempt 投影」):落盘
 * `AttemptRecord` 全字段 + 归属身份。运行时对应类型是 `EvalResult`——`AttemptHandle.result` 已
 * 把快照级字段拼合成的瘦身条目(见 `src/record/types.ts` 的 `AttemptHandle` 字段注释);
 * `experimentId` 与 `snapshotStartedAt` 补足「归属身份」,与组件自己的 `*Data` 声明共用同一条
 * 「字段名复用落盘类型、不发明第二套命名」纪律。只有 [`history`](../../docs/feature/reports/show/history.md)
 * 这个不进组件模型的切片直接消费它——其余 view 的 `data` 字段单源在各自组件的 `*Data` 声明,
 * 那些声明各自已经携带自己需要的身份子集(如 `UsageTableData.experimentId`/`.evalId`/`.attempt`),
 * 不重复套这层通用投影。
 */
export type AttemptJson = EvalResult & {
  experimentId: string;
  snapshotStartedAt: string;
};

export function attemptJsonOf(attempt: AttemptHandle): AttemptJson {
  return { ...attempt.result, experimentId: attempt.experimentId, snapshotStartedAt: attempt.run.startedAt };
}

/** 信封的 `scope` 字段;`patterns` 为空时省略 `evalPrefix`(与「省略不是一种有含义的取值」同一条纪律)。 */
export function buildShowScope(input: {
  resultsRoot: string;
  patterns: readonly string[];
  experiments: readonly string[];
  fresh: boolean;
}): ShowJson["scope"] {
  return {
    resultsRoot: input.resultsRoot,
    ...(input.patterns.length > 0 ? { evalPrefix: input.patterns.join(",") } : {}),
    experiments: [...input.experiments],
    fresh: input.fresh,
  };
}

/**
 * stdout 的单文档序列化(docs/feature/reports/show/json.md「输出是一个顶层 JSON 文档」):不
 * 缩进(单行,jq 友好、与 `exp --dry --json` 的 `renderJsonPlanDocument` 同一惯例),末尾补一个
 * 换行,不是 NDJSON——一次调用只有这一个文档。
 */
export function renderShowJson(doc: ShowJson): string {
  return `${JSON.stringify(doc)}\n`;
}
