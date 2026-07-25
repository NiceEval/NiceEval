# 比较质量、成本与前沿

## 解决什么问题

多个 Agent、模型或 flags 都跑了同批 Eval,你要找到质量和成本的取舍,而不是只按一个分数排名。

## 全流程

1. 先用 `ExperimentComparison` 展示当前 Scope 的零配置总览:前沿散点 + 逐 Experiment 明细。
2. 需要替换坐标时用 `ScatterChart`,`points` 选 Experiment,`by` 选 agent 或 label。
3. 需要同时审查三个以上指标时改用 `MetricTable`,让 samples/total 和证据 refs 留在每个格子。
4. 从异常点的 locator 下钻 Attempt,确认差异来自任务表现还是执行错误。

## 边界

- 要回答「A 精确比 B 差多少」时用 `DeltaTable`,不用散点图目测。
- 固定题集的总分和分科分属于 `Scoreboard`,不是前沿比较。
