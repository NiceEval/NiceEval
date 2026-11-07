# 分组主体从 AttemptHandle 改为 Eval 级 AggregationSubject

- **现象**：basis 定为 "eval"、total 计入 coverage 缺口后，
  `aggregate().by` 的分组函数还收 AttemptHandle 就自相矛盾——
  没跑到的题没有任何 attempt，无法经分组函数归组，
  也就进不了任何一行的 total。
- **裁决**（2026-07-29）：分组以题级单元（Experiment × Eval）为单位，
  分组函数收 `AggregationSubject { experimentId, evalId, run }`，
  coverage 缺口单元照常归组、照常进 total。
  连带收益：分组函数拿不到 AttemptHandle，
  不可能把同一道题的 attempts 切进两个组，
  withinEval 折叠边界由类型保护。
- **同日补齐锚点 Run**（plan 前置）：
  `ExperimentRunInfo` 不含 Run 顶层的 agent/model，也不含 experimentId；
  全缺口 Experiment 还可能没有任何 `Sample.runs`。
  因此每个 `SampleCoverage` 保留确定的 Experiment 锚点 Run
  （`latestRunSample` → latest Run；`currentSample` → 确定可比性配置的 latest Run），
  官方分组固定读：`experiment` ← experimentId，`agent`/`model` ← Run 顶层，
  flags/labels/运行配置 ← `run.experiment`。
  曾选 `{ evalId, experiment: ExperimentRunInfo }` 不够回答
  「零 attempt 的 Eval 按 agent 分到哪一行」，否决。
- **曾选方案**：
  1. 保留 attempt 级分组、缺口只在内建实验级维度下计入 total——
     total 的含义随分组函数不同而漂移，否决。
  2. 保留 attempt 级分组、total 不含缺口——推翻「coverage 缺口进分母」，
     榜单会把缺一半题的配置报成满覆盖，否决。
- 落点：docs/feature/reports/library.md（分组函数与计算函数、自定义分组、
  aggregate 内部职责）、architecture.md（错误反馈的分组错误坐标）、
  docs/feature/sample/library.md（SampleCoverage.run）、
  `src/record/types.ts` / `src/sample/index.ts`。
